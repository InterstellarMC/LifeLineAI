import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, Schema } from '@google/genai';
import { Mic, MicOff, Video, VideoOff, Play, Square, Loader2, Upload, FileText, Image as ImageIcon } from 'lucide-react';
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

// --- Tool Definition for Live API ---
// This allows the real-time voice model to update the dashboard
const updateTriageStatusTool: FunctionDeclaration = {
  name: 'updateTriageStatus',
  description: 'Update the medical triage dashboard with diagnosis and instructions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      condition: { type: Type.STRING, description: 'Probable medical condition.' },
      riskLevel: { type: Type.STRING, enum: ['LOW', 'MODERATE', 'EMERGENCY'], description: 'Overall urgency level.' },
      immediateAction: { type: Type.STRING, description: 'Step-by-step first aid instructions.' },
      hospitalUrgency: { type: Type.STRING, enum: ['STAY_HOME', 'VISIT_DOCTOR', 'RUSH_TO_ER'], description: 'Recommendation on visiting a hospital.' },
      department: { type: Type.STRING, description: 'Which medical specialist is needed (e.g. Cardiology).' },
      contraindications: { type: Type.STRING, description: 'What the patient should definitely NOT do.' },
      reasoning: { type: Type.STRING, description: 'Brief medical reasoning for the assessment.' }
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
5. **Tone:** Professional, calm, concise. No fluff.

**Output Fields Guide:**
- **Risk Level:** EMERGENCY (Life threatening), MODERATE (Urgent care needed), LOW (Self-care).
- **Hospital Urgency:** RUSH_TO_ER (Immediate), VISIT_DOCTOR (Next 24h), STAY_HOME.
- **Contraindications:** Crucial warnings (e.g., "Do not give water if choking", "Do not move if neck injury suspected").
`;

const LiveTriage: React.FC = () => {
  // --- State ---
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAnalyzingUpload, setIsAnalyzingUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triageStatus, setTriageStatus] = useState<TriageStatus | null>(null);
  const [transcription, setTranscription] = useState<string>('');

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

  // --- Initialization ---
  const startSession = async () => {
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      // We try to request 24k, but the browser might ignore it and give us 48k. 
      // We must check audioCtx.sampleRate later.
      const audioCtx = new AudioContextClass({ sampleRate: AUDIO_OUTPUT_SAMPLE_RATE });
      await audioCtx.resume();
      audioContextRef.current = audioCtx;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [updateTriageStatusTool] }],
        },
        callbacks: {
          onopen: () => {
            console.log("Live Session Connected");
            setIsConnected(true);
            setIsStreaming(true);
          },
          onmessage: async (message: LiveServerMessage) => {
            handleServerMessage(message, audioCtx);
          },
          onclose: () => {
            console.log("Live Session Closed");
            setIsConnected(false);
            setIsStreaming(false);
          },
          onerror: (err) => {
            console.error("Live Session Error", err);
            setError("Connection error. Please restart.");
            stopSession();
          }
        }
      });

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // Important: Downsample to 16kHz before sending to Gemini
        const downsampledData = downsampleTo16k(inputData, audioCtx.sampleRate);
        const blob = createAudioContentBlob(downsampledData);
        
        // Use promise to ensure session is ready
        sessionPromise.then(session => {
          sessionRef.current = session;
          session.sendRealtimeInput({ media: blob });
        }).catch(e => {
          console.error("Error sending audio:", e);
        });
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
      
      inputSourceRef.current = source;
      processorRef.current = processor;

      startVideoStreaming(sessionPromise);

    } catch (err: any) {
      console.error(err);
      setError("Failed to access camera/microphone or connect to AI.");
    }
  };

  const startVideoStreaming = (sessionPromise: Promise<any>) => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    
    frameIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = video.videoWidth * 0.5;
      canvas.height = video.videoHeight * 0.5;
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob(async (blob) => {
        if (blob) {
          const base64 = await blobToBase64(blob);
          sessionPromise.then(session => {
             session.sendRealtimeInput({
               media: {
                 mimeType: 'image/jpeg',
                 data: base64
               }
             });
          }).catch(e => {
            // Ignore frame send errors if session is closed
          });
        }
      }, 'image/jpeg', 0.6);
    }, 1000); 
  };

  const handleServerMessage = async (message: LiveServerMessage, audioCtx: AudioContext) => {
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
          setTriageStatus({
             condition: fc.args.condition as string,
             riskLevel: fc.args.riskLevel as SeverityLevel,
             immediateAction: fc.args.immediateAction as string,
             hospitalUrgency: fc.args.hospitalUrgency as any,
             department: fc.args.department as string,
             contraindications: fc.args.contraindications as string,
             reasoning: fc.args.reasoning as string,
             lastUpdated: Date.now(),
             source: 'LIVE_OBSERVATION'
          });
          responses.push({
            id: fc.id,
            name: fc.name,
            response: { result: "Status updated." }
          });
        }
      }
      if (responses.length > 0 && sessionRef.current) {
        sessionRef.current.sendToolResponse({ functionResponses: responses });
      }
    }
    
    if (message.serverContent?.inputTranscription?.text) {
       setTranscription(`You: ${message.serverContent.inputTranscription.text}`);
    }
    if (message.serverContent?.outputTranscription?.text) {
       setTranscription(`LifeLine: ${message.serverContent.outputTranscription.text}`);
    }
  };

  // --- GEMINI 3 PRO DEEP SCAN (Static File Upload) ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzingUpload(true);
    setTriageStatus(null); // Clear current status to show analyzing state

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Convert file to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Gemini 3 Pro Call for Deep Analysis
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview', // Using Pro for deep reasoning
        contents: {
          parts: [
            { inlineData: { mimeType: file.type, data: base64 } },
            { text: `Analyze this medical image (ECG, medicine, injury, or report). 
                     Provide a strict JSON output matching this schema:
                     {
                       "condition": "Probable medical condition or 'Unknown'",
                       "riskLevel": "LOW" | "MODERATE" | "EMERGENCY",
                       "immediateAction": "First aid steps",
                       "hospitalUrgency": "STAY_HOME" | "VISIT_DOCTOR" | "RUSH_TO_ER",
                       "department": "Relevant specialist e.g. Cardiology",
                       "contraindications": "What NOT to do",
                       "reasoning": "Detailed medical reasoning based on visual evidence"
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
      }

    } catch (err) {
      console.error("Analysis Failed", err);
      setError("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzingUpload(false);
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const stopSession = () => {
    if (inputSourceRef.current) inputSourceRef.current.disconnect();
    if (processorRef.current) processorRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsConnected(false);
    setIsStreaming(false);
    setTriageStatus(null);
  };

  useEffect(() => {
    return () => stopSession();
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col bg-black overflow-hidden rounded-xl border border-zinc-800 shadow-2xl">
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
         <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.2)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
         <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80"></div>
      </div>

      {/* Heads Up Display */}
      <StatusHUD status={triageStatus} isActive={isConnected} isAnalyzing={isAnalyzingUpload} />

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