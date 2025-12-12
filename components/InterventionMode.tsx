import React, { useEffect, useState, useRef } from 'react';
import { HeartPulse, XCircle, Volume2, VolumeX } from 'lucide-react';

interface InterventionModeProps {
  isActive: boolean;
  onClose: () => void;
}

const InterventionMode: React.FC<InterventionModeProps> = ({ isActive, onClose }) => {
  const [step, setStep] = useState(0);
  const [muted, setMuted] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) return;

    // Initialize Audio Context for the Metronome
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new AudioContextClass();

    const bpm = 110; // American Heart Association recommendation
    const interval = 60000 / bpm;

    const playTone = () => {
      if (!audioCtxRef.current || muted) return;
      
      const oscillator = audioCtxRef.current.createOscillator();
      const gainNode = audioCtxRef.current.createGain();

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(800, audioCtxRef.current.currentTime); // 800Hz tone
      oscillator.frequency.exponentialRampToValueAtTime(400, audioCtxRef.current.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0.5, audioCtxRef.current.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtxRef.current.currentTime + 0.1);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtxRef.current.destination);

      oscillator.start();
      oscillator.stop(audioCtxRef.current.currentTime + 0.1);
    };

    const loop = () => {
      playTone();
      setStep((s) => (s === 0 ? 1 : 0)); // Toggle visual state
    };

    timerRef.current = window.setInterval(loop, interval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, [isActive, muted]);

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden bg-black">
      {/* Background Pulse Animation */}
      <div 
        className={`absolute inset-0 transition-colors duration-100 ease-in-out ${
          step === 0 ? 'bg-red-600' : 'bg-black'
        }`} 
      />
      
      {/* Central Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 text-center px-4">
        
        <div className="bg-black/80 backdrop-blur-xl p-8 rounded-3xl border-4 border-white shadow-2xl flex flex-col items-center gap-4">
           <div className="flex items-center gap-3 text-red-500 mb-2">
             <HeartPulse className="w-12 h-12 animate-pulse" />
             <span className="text-2xl font-black uppercase tracking-widest">CPR Protocol</span>
           </div>

           <h1 className="text-6xl md:text-8xl font-black text-white uppercase leading-none tracking-tighter">
             Push<br/>Hard
           </h1>
           
           <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden mt-4">
             <div className="h-full bg-white transition-all duration-100 ease-linear" style={{ width: step === 0 ? '100%' : '0%' }} />
           </div>

           <p className="text-xl font-mono text-zinc-300 font-bold mt-2">
             MATCH THE BEAT (110 BPM)
           </p>
        </div>

        {/* Instructions */}
        <div className="bg-red-950/80 backdrop-blur border border-red-500/50 p-6 rounded-xl max-w-md text-left">
           <ol className="list-decimal list-inside space-y-2 text-lg font-medium text-white">
             <li>Place hands on center of chest.</li>
             <li>Interlock fingers.</li>
             <li>Push down 2 inches (5cm).</li>
             <li>Let chest rise completely.</li>
           </ol>
        </div>

      </div>

      {/* Controls */}
      <div className="absolute bottom-12 flex gap-4 z-20">
         <button 
           onClick={() => setMuted(!muted)}
           className="w-16 h-16 rounded-full bg-zinc-800 border-2 border-zinc-600 flex items-center justify-center text-white hover:bg-zinc-700 active:scale-95 transition-all"
         >
           {muted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
         </button>
         
         <button 
           onClick={onClose}
           className="h-16 px-8 rounded-full bg-white text-black font-black text-xl uppercase tracking-wider flex items-center gap-2 hover:bg-zinc-200 active:scale-95 transition-all shadow-[0_0_30px_rgba(255,255,255,0.3)]"
         >
           <XCircle className="w-6 h-6" />
           Stop CPR
         </button>
      </div>

    </div>
  );
};

export default InterventionMode;