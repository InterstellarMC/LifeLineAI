import React, { useState } from 'react';
import LiveTriage from './components/LiveTriage';
import { Activity, ShieldAlert, Info } from 'lucide-react';

const App: React.FC = () => {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-black/50 backdrop-blur-sm fixed w-full z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center shadow-[0_0_15px_rgba(220,38,38,0.5)]">
            <Activity className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">LifeLine <span className="text-zinc-500 font-normal">AI</span></h1>
        </div>
        <button 
          onClick={() => setShowInfo(!showInfo)}
          className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
        >
          <Info className="w-5 h-5 text-zinc-400" />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-grow pt-20 pb-6 px-4 md:px-6 flex flex-col h-screen">
        <div className="w-full max-w-6xl mx-auto flex-grow flex flex-col gap-4">
           {/* Disclaimer Banner */}
           <div className="bg-yellow-900/20 border border-yellow-700/30 p-3 rounded-lg flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-200/80 leading-snug">
                <span className="font-bold text-yellow-500">DEMO ONLY. NOT MEDICAL ADVICE.</span> 
                <br className="md:hidden"/>
                LifeLine AI can make mistakes. In a real emergency, call professional services immediately.
              </p>
           </div>

           {/* The Triage Core */}
           <div className="flex-grow min-h-[500px]">
             <LiveTriage />
           </div>
        </div>
      </main>

      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-2xl font-bold mb-4">About LifeLine AI</h2>
            <p className="text-zinc-400 mb-4 leading-relaxed">
              LifeLine is a multimodal triage concept powered by Google Gemini 2.5 Flash.
              It uses real-time audio and video streaming to assess medical situations rapidly.
            </p>
            <ul className="space-y-2 mb-6 text-sm text-zinc-300">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                Real-time Voice Conversation
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                Visual Symptom Analysis
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                Instant Emergency Grading
              </li>
            </ul>
            <button 
              onClick={() => setShowInfo(false)}
              className="w-full py-3 bg-zinc-100 hover:bg-white text-black font-bold rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
