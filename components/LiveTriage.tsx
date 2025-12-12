import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, Schema } from '@google/genai';
import { Mic, MicOff, Video, VideoOff, Play, Square, Loader2, Upload, FileText, Image as ImageIcon, Settings, X, Gauge, Layers, MapPin, ScanLine } from 'lucide-react';
import { 
  createAudioContentBlob, 
  decodeAudioData, 
  base64ToUint8Array, 
  blobToBase64,
  downsampleTo16k,
  AUDIO_INPUT_SAMPLE_RATE, 
  AUDIO_OUTPUT_SAMPLE_RATE 
} from '../utils/audio';
import { TriageStatus, SeverityLevel } from '../types';
import StatusHUD from './StatusHUD';
import AudioWaveform from './AudioWaveform';
import InterventionMode from './InterventionMode';

// --- Tool Definition for Live API ---
const updateTriageStatusTool: FunctionDeclaration = {
  name: 'updateTriageStatus',
  description: 'Update the medical triage dashboard with diagnosis, instructions, and nearest hospital.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      condition: { type: Type.STRING, description: 'Probable medical condition.' },
      riskLevel: { type: Type.STRING, enum: ['LOW', 'MODERATE', 'EMERGENCY'], description: 'Overall urgency level.' },
      immediateAction: { type: Type.STRING, description: 'Step-by-step first aid instructions.' },
      hospitalUrgency: { type: Type.STRING, enum: ['STAY_HOME', 'VISIT_DOCTOR', 'RUSH_TO_ER'], description: 'Recommendation on visiting a hospital.' },
      department: { type: Type.STRING, description: 'Which medical specialist is needed (e.g. Cardiology).' },
      contraindications: { type: Type.STRING, description: 'What the patient should definitely NOT do.' },
      reasoning: { type: Type.STRING, description: 'Brief medical reasoning for the assessment.' },
      recommendedHospital: {
        type: Type.OBJECT,
        description: 'Nearest appropriate hospital or medical center based on user location.',
        properties: {
          name: { type: Type.STRING },
          address: { type: Type.STRING },
          travelTime: { type: Type.STRING, description: "Estimated travel time e.g. '15 mins'" }
        },
        required: ['name', 'address', 'travelTime']
      }
    },
    required: ['condition', 'riskLevel', 'immediateAction', 'hospitalUrgency', 'department', 'contraindications', 'reasoning']
  }
};

const SYSTEM_INSTRUCTION = `You are LifeLine AI, an expert emergency triage doctor.
Your goal is to quickly assess medical situations via voice and video and provide a structured triage report.

**Operational Rules:**
1. **Visuals:** Actively look for physical signs (pallor, sweating, bleeding, breathing effort, rash, swelling).
2. **Questioning:** Ask short, high-yield questions. "Where does it hurt?", "History of heart issues?", "Any allergies?".
3. **Updating Dashboard:** You MUST call the \`updateTriageStatus\` tool whenever you have a hypothesis or new information. Do not wait for the end of the conversation.
4. **Safety:** If Risk Level is EMERGENCY, your spoken response must be authoritative and instruct them to call EMS/911 immediately.
5. **CPR Protocol:** If the patient is unconscious and not breathing, explicitly instruct to start CPR in \`immediateAction\`.
6. **Tone:** Professional, calm, concise. No fluff.

**Output Fields Guide:**
- **Risk Level:** EMERGENCY (Life threatening), MODERATE (Urgent care needed), LOW (Self-care).
- **Hospital Urgency:** RUSH_TO_ER (Immediate), VISIT_DOCTOR (Next 24h), STAY_HOME.
- **Contraindications:** Crucial warnings (e.g., "Do not give water if choking", "Do not move if neck injury suspected").
- **Recommended Hospital:** Suggest the nearest real facility based on provided coordinates. If unknown, say "Nearest Emergency Room".
`;

const LiveTriage: React.FC = () => {
  // --- State ---
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAnalyzingUpload, setIsAnalyzingUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triageStatus, setTriageStatus] = useState<TriageStatus | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [audioAnalyser, setAudioAnalyser] = useState<AnalyserNode | null>(null);
  const [userLocation, setUserLocation] = useState<string>('Unknown');
  const [isCPRMode, setIsCPRMode] = useState(false);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [fps, setFps] = useState<number>(1);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null); 
  const frameIntervalRef = useRef<number | null>(null);
  const activeRef = useRef<boolean>(false);

  // --- Demo Mode Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only active if we have some UI interaction potential
      if (e.key.toLowerCase() === 'e') {
        // Force Emergency
        setTriageStatus({
          condition: "Cardiac Arrest",
          riskLevel: "EMERGENCY",
          immediateAction: "Patient is unresponsive. Start CPR immediately.",
          hospitalUrgency: "RUSH_TO_ER",
          department: "Trauma / Cardiology",
          contraindications: "Do not stop compressions.",
          reasoning: "Visual confirmation of unconsciousness and no breathing movement.",
          recommendedHospital: {
             name: "General Hospital Trauma Center",
             address: "123 Medical Blvd",
             travelTime: "8 mins"
          },
          lastUpdated: Date.now(),
          source: 'LIVE_OBSERVATION'
        });
      }
      if (e.key.toLowerCase() === 'c') {
        // Force CPR Mode
        setIsCPRMode(true);
      }
      if (e.key.toLowerCase() === 'r') {
        // Reset
        setTriageStatus(null);
        setIsCPRMode(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Initialization ---
  const getUserLocation = async (): Promise<string> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve("Unknown");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve(`${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
        },
        (err) => {
          console.warn("Geolocation access denied or failed", err);
          resolve("Unknown (Permission Denied)");
        },
        { timeout: 5000 }
      );
    });
  };

  const stopSession = useCallback(() => {
    activeRef.current = false;
    
    // Stop Audio Processing First
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    
    // Close Audio Context Safely
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (e) {
        console.warn("Error closing AudioContext", e);
      }
    }
    audioContextRef.current = null;

    // Stop Video Processing
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }

    // Close GenAI Session
    if (sessionRef.current) {
       // Best effort close
       try {
         sessionRef.current.close();
       } catch (e) {
         console.warn("Error closing session", e);
       }
       sessionRef.current = null;
    }

    setIsConnected(false);
    setIsStreaming(false);
    setAudioAnalyser(null);
    setTriageStatus(null);
    setIsCPRMode(false);
  }, []);

  const startSession = async () => {
    setError(null);
    stopSession(); // Ensure clean state
    activeRef.current = true;

    try {
      // 1. Get Location First
      const location = await getUserLocation();
      if (!activeRef.current) return;
      setUserLocation(location);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (!activeRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: AUDIO_OUTPUT_SAMPLE_RATE });
      await audioCtx.resume();
      audioContextRef.current = audioCtx;

      // Setup Audio Analysis for Visualizer
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      setAudioAnalyser(analyser);

      // Inject Location into System Instructions
      const locationContext = `\n\n**USER CONTEXT:**\nLocation Coordinates: ${location}\nCurrent Time: ${new Date().toLocaleTimeString()}\nUse this location to recommend real, nearby hospitals if the user needs to go to one.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          systemInstruction: SYSTEM_INSTRUCTION + locationContext,
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [updateTriageStatusTool] }],
        },
        callbacks: {
          onopen: () => {
            console.log("Live Session Connected");
            if (activeRef.current) {
              setIsConnected(true);
              setIsStreaming(true);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
             if (!activeRef.current) return;
             handleServerMessage(message, audioCtx);
          },
          onclose: () => {
            console.log("Live Session Closed");
            if (activeRef.current) stopSession();
          },
          onerror: (err) => {
            console.error("Live Session Error", err);
            // Handle service unavailable gracefully
            if (activeRef.current) {
               setError("Service unavailable. Retrying...");
               // Optional: Auto-retry logic could go here, but for now we stop to let user try again.
               stopSession(); 
               setError("Connection failed. Service may be unavailable.");
            }
          }
        }
      });
      
      sessionPromise.then(sess => {
        if (activeRef.current) {
          sessionRef.current = sess;
        } else {
          sess.close();
        }
      }).catch(err => {
         console.error("Connection failed", err);
         if (activeRef.current) {
            setError("Failed to connect to AI Service.");
            stopSession();
         }
      });

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (!activeRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampledData = downsampleTo16k(inputData, audioCtx.sampleRate);
        const blob = createAudioContentBlob(downsampledData);
        
        sessionPromise.then(session => {
          if (activeRef.current) {
             try {
                session.sendRealtimeInput({ media: blob });
             } catch (e) {
                // Ignore send errors if session is unstable
             }
          }
        });
      };

      source.connect(analyser);
      source.connect(processor);
      processor.connect(audioCtx.destination);
      
      inputSourceRef.current = source;
      processorRef.current = processor;

    } catch (err: any) {
      console.error(err);
      setError("Failed to access camera/microphone or connect to AI.");
      stopSession();
    }
  };

  // --- Dynamic Video Streaming Effect ---
  useEffect(() => {
    if (!isStreaming || !isConnected) {
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      return;
    }

    const intervalMs = 1000 / fps;

    const captureAndSendFrame = async () => {
      if (!videoRef.current || !canvasRef.current || !sessionRef.current || !activeRef.current) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let scale = 0.5; // Medium (default)
      if (quality === 'low') scale = 0.25;
      if (quality === 'high') scale = 1.0;

      if (video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth * scale;
          canvas.height = video.videoHeight * scale;
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const jpegQuality = quality === 'low' ? 0.5 : 0.7;
          
          canvas.toBlob(async (blob) => {
            if (blob && activeRef.current) {
              const base64 = await blobToBase64(blob);
              try {
                sessionRef.current.sendRealtimeInput({
                  media: {
                    mimeType: 'image/jpeg',
                    data: base64
                  }
                });
              } catch (e) {
                // Ignore transient send errors
              }
            }
          }, 'image/jpeg', jpegQuality);
      }
    };

    frameIntervalRef.current = window.setInterval(captureAndSendFrame, intervalMs);

    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    };
  }, [isConnected, isStreaming, fps, quality]);

  const handleServerMessage = async (message: LiveServerMessage, audioCtx: AudioContext) => {
    try {
        const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData) {
          const audioBuffer = await decodeAudioData(base64ToUint8Array(audioData), audioCtx);
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);
          
          const currentTime = audioCtx.currentTime;
          const startTime = Math.max(nextStartTimeRef.current, currentTime);
          source.start(startTime);
          nextStartTimeRef.current = startTime + audioBuffer.duration;
        }

        if (message.toolCall) {
          const responses = [];
          for (const fc of message.toolCall.functionCalls) {
            if (fc.name === 'updateTriageStatus') {
              console.log("Updating Triage Status:", fc.args);
              
              const statusData = {
                 condition: fc.args.condition as string,
                 riskLevel: fc.args.riskLevel as SeverityLevel,
                 immediateAction: fc.args.immediateAction as string,
                 hospitalUrgency: fc.args.hospitalUrgency as any,
                 department: fc.args.department as string,
                 contraindications: fc.args.contraindications as string,
                 reasoning: fc.args.reasoning as string,
                 recommendedHospital: fc.args.recommendedHospital as any,
                 lastUpdated: Date.now(),
                 source: 'LIVE_OBSERVATION'
              };
              
              setTriageStatus(statusData as any);

              // Check for CPR keywords to trigger Intervention Mode
              const actionText = (fc.args.immediateAction as string).toLowerCase();
              if (actionText.includes('cpr') || actionText.includes('chest compression') || actionText.includes('resuscitation')) {
                setIsCPRMode(true);
              }

              responses.push({
                id: fc.id,
                name: fc.name,
                response: { result: "Status updated." }
              });
            }
          }
          if (responses.length > 0 && sessionRef.current && activeRef.current) {
            sessionRef.current.sendToolResponse({ functionResponses: responses });
          }
        }
        
        if (message.serverContent?.inputTranscription?.text) {
           setTranscription(`You: ${message.serverContent.inputTranscription.text}`);
        }
        if (message.serverContent?.outputTranscription?.text) {
           setTranscription(`LifeLine: ${message.serverContent.outputTranscription.text}`);
        }
    } catch (e) {
        console.error("Error processing server message", e);
    }
  };

  // --- GEMINI 3 PRO DEEP SCAN (Static File Upload) ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzingUpload(true);
    setTriageStatus(null); 

    try {
      // Get location for Deep Scan too
      const location = await getUserLocation();
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', 
        contents: {
          parts: [
            { inlineData: { mimeType: file.type, data: base64 } },
            { text: `Analyze this medical image. User Location: ${location}.
                     Provide a strict JSON output matching this schema:
                     {
                       "condition": "Probable medical condition or 'Unknown'",
                       "riskLevel": "LOW" | "MODERATE" | "EMERGENCY",
                       "immediateAction": "First aid steps",
                       "hospitalUrgency": "STAY_HOME" | "VISIT_DOCTOR" | "RUSH_TO_ER",
                       "department": "Relevant specialist e.g. Cardiology",
                       "contraindications": "What NOT to do",
                       "reasoning": "Detailed medical reasoning",
                       "recommendedHospital": {
                          "name": "Name of nearest hospital",
                          "address": "Address",
                          "travelTime": "Estimated time"
                       }
                     }` 
            }
          ]
        },
        config: {
          responseMimeType: 'application/json'
        }
      });

      if (response.text) {
        const data = JSON.parse(response.text);
        setTriageStatus({
          ...data,
          lastUpdated: Date.now(),
          source: 'DEEP_SCAN'
        });
        
        // Trigger CPR mode for Deep Scan too if needed
        const actionText = (data.immediateAction || "").toLowerCase();
        if (actionText.includes('cpr') || actionText.includes('chest compression')) {
           setIsCPRMode(true);
        }
      }

    } catch (err) {
      console.error("Analysis Failed", err);
      setError("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzingUpload(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    return () => stopSession();
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col bg-black overflow-hidden rounded-xl border border-zinc-800 shadow-2xl group">
      {/* Background Video Layer */}
      <div className="absolute inset-0 z-0">
         <video 
           ref={videoRef} 
           autoPlay 
           playsInline 
           muted 
           className="w-full h-full object-cover opacity-60" 
         />
         <canvas ref={canvasRef} className="hidden" />
         
         {/* Tech Grid Overlay */}
         <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.2)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
         <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80"></div>
         
         {/* Active Scanner Overlay - Only when connected */}
         {isConnected && !isCPRMode && (
           <div className="absolute inset-0 pointer-events-none">
             {/* Corner Reticles */}
             <div className="absolute top-8 left-8 w-16 h-16 border-t-2 border-l-2 border-blue-500/50 rounded-tl-xl" />
             <div className="absolute top-8 right-8 w-16 h-16 border-t-2 border-r-2 border-blue-500/50 rounded-tr-xl" />
             <div className="absolute bottom-8 left-8 w-16 h-16 border-b-2 border-l-2 border-blue-500/50 rounded-bl-xl" />
             <div className="absolute bottom-8 right-8 w-16 h-16 border-b-2 border-r-2 border-blue-500/50 rounded-br-xl" />
             
             {/* Scanning Line Animation */}
             <div className="absolute inset-x-0 h-0.5 bg-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.5)] animate-[scan_3s_ease-in-out_infinite]" />
             
             {/* Center Focus */}
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border border-white/10 rounded-full flex items-center justify-center">
               <div className="w-1 h-1 bg-red-500/50 rounded-full animate-ping" />
             </div>
             
             {/* Status Badge */}
             <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-blue-950/80 backdrop-blur border border-blue-500/30 px-3 py-1 rounded text-[10px] font-mono text-blue-300 uppercase tracking-widest flex items-center gap-2">
               <ScanLine className="w-3 h-3 animate-pulse" />
               Visual Analysis Active
             </div>
           </div>
         )}
      </div>

      {/* Heads Up Display (Hidden during CPR) */}
      {!isCPRMode && (
         <StatusHUD status={triageStatus} isActive={isConnected} isAnalyzing={isAnalyzingUpload} />
      )}

      {/* CPR Intervention Mode (Overlay) */}
      <InterventionMode isActive={isCPRMode} onClose={() => setIsCPRMode(false)} />

      {/* Audio Waveform Visualization */}
      <AudioWaveform analyser={audioAnalyser} isActive={isConnected} />

      {/* Settings Button */}
      <div className="absolute top-4 left-4 z-40 flex items-center gap-2">
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={`p-3 rounded-full backdrop-blur-md border transition-all ${showSettings ? 'bg-white text-black border-white' : 'bg-black/40 text-zinc-300 border-zinc-700 hover:bg-black/60'}`}
        >
          {showSettings ? <X className="w-5 h-5" /> : <Settings className="w-5 h-5" />}
        </button>
        {isConnected && userLocation !== 'Unknown' && (
           <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30 backdrop-blur-md text-[10px] font-mono text-blue-200">
             <MapPin className="w-3 h-3" />
             <span>LOC: {userLocation}</span>
           </div>
        )}
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute top-16 left-4 z-40 w-64 bg-black/90 backdrop-blur-xl border border-zinc-800 rounded-xl p-4 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-200">
           <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Stream Configuration</h3>
           
           {/* Resolution Control */}
           <div className="mb-6">
             <div className="flex items-center gap-2 mb-2 text-zinc-300">
               <Layers className="w-4 h-4 text-blue-400" />
               <span className="text-sm font-medium">Resolution</span>
             </div>
             <div className="grid grid-cols-3 gap-2">
               {(['low', 'medium', 'high'] as const).map((q) => (
                 <button
                   key={q}
                   onClick={() => setQuality(q)}
                   className={`px-2 py-1.5 rounded text-xs font-mono border transition-all ${
                     quality === q 
                     ? 'bg-blue-600 border-blue-500 text-white' 
                     : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-600'
                   }`}
                 >
                   {q.toUpperCase()}
                 </button>
               ))}
             </div>
           </div>

           {/* FPS Control */}
           <div>
             <div className="flex items-center justify-between mb-2 text-zinc-300">
                <div className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-medium">Frame Rate</span>
                </div>
                <span className="text-xs font-mono text-emerald-400">{fps} FPS</span>
             </div>
             <input 
               type="range" 
               min="0.5" 
               max="10" 
               step="0.5" 
               value={fps}
               onChange={(e) => setFps(parseFloat(e.target.value))}
               className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
             />
             <div className="flex justify-between mt-1 text-[10px] text-zinc-600 font-mono">
               <span>Slow</span>
               <span>Smooth</span>
             </div>
           </div>
        </div>
      )}

      {/* Main Controls & Feedback */}
      <div className="relative z-10 flex-grow flex flex-col justify-end p-6 md:p-12">
        
        {transcription && (
          <div className="mb-8 self-center bg-black/50 backdrop-blur text-zinc-100 px-6 py-3 rounded-full text-center max-w-2xl border border-zinc-700/50 shadow-lg transition-all">
            <p className="text-lg font-medium">{transcription}</p>
          </div>
        )}

        {error && (
          <div className="mb-4 self-center text-red-400 bg-red-950/50 px-4 py-2 rounded border border-red-900">
            {error}
          </div>
        )}

        {/* Control Bar */}
        <div className="flex items-center justify-center gap-6">
          {/* Upload Button */}
          <div className="absolute left-6 md:left-12 bottom-6 md:bottom-12">
             <input 
               type="file" 
               ref={fileInputRef} 
               onChange={handleFileUpload} 
               accept="image/*" 
               className="hidden" 
             />
             <button 
               onClick={() => fileInputRef.current?.click()}
               disabled={isAnalyzingUpload}
               className="flex flex-col items-center gap-2 group"
             >
               <div className="w-12 h-12 rounded-full bg-zinc-800/80 backdrop-blur border border-zinc-700 flex items-center justify-center hover:bg-zinc-700 transition-all group-disabled:opacity-50">
                  {isAnalyzingUpload ? <Loader2 className="w-5 h-5 animate-spin text-blue-400"/> : <Upload className="w-5 h-5 text-zinc-300" />}
               </div>
               <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 group-hover:text-zinc-200">
                 Upload Data
               </span>
             </button>
          </div>

          {/* Main Play/Stop Button */}
          {!isConnected ? (
            <button 
              onClick={startSession}
              className="group relative flex items-center justify-center w-20 h-20 rounded-full bg-zinc-100 hover:bg-white text-black transition-all shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:shadow-[0_0_60px_rgba(255,255,255,0.5)] scale-100 hover:scale-105 active:scale-95"
            >
               <div className="absolute inset-0 rounded-full border border-white opacity-20 animate-ping"></div>
               <Play className="w-8 h-8 fill-black ml-1" />
            </button>
          ) : (
             <button 
              onClick={stopSession}
              className="group flex items-center justify-center w-20 h-20 rounded-full bg-red-600 hover:bg-red-500 text-white transition-all shadow-[0_0_40px_rgba(220,38,38,0.4)] scale-100 hover:scale-105 active:scale-95"
            >
               <Square className="w-8 h-8 fill-white" />
            </button>
          )}

          {/* Decorative / Future Features */}
          <div className="absolute right-6 md:right-12 bottom-6 md:bottom-12 opacity-50 pointer-events-none">
             <div className="flex flex-col items-center gap-2">
               <div className="w-12 h-12 rounded-full border border-zinc-800 flex items-center justify-center">
                  <Mic className="w-5 h-5 text-zinc-600" />
               </div>
               <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                 Voice Active
               </span>
             </div>
          </div>
        </div>
        
        <p className="text-center text-zinc-500 mt-4 text-sm font-mono uppercase tracking-widest">
          {isConnected ? "Live Triage • Monitoring Vitals" : "System Standby • Initialize to Begin"}
        </p>
      </div>
    </div>
  );
};

export default LiveTriage;