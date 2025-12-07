import React from 'react';
import { TriageStatus } from '../types';
import { 
  Activity, 
  AlertTriangle, 
  HeartPulse, 
  Hospital, 
  Ban, 
  Stethoscope, 
  Siren, 
  CheckCircle2,
  FileSearch
} from 'lucide-react';

interface StatusHUDProps {
  status: TriageStatus | null;
  isActive: boolean;
  isAnalyzing?: boolean;
}

const StatusHUD: React.FC<StatusHUDProps> = ({ status, isActive, isAnalyzing }) => {
  if (!status && !isAnalyzing) {
    return (
      <div className="absolute top-4 right-4 z-20 w-full max-w-sm bg-black/60 backdrop-blur-md border border-zinc-800 rounded-xl p-6 text-zinc-400 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
          <span className="text-xs font-mono uppercase tracking-widest text-zinc-500">System Standby</span>
        </div>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-zinc-300">
            <strong className="text-white block mb-1">Ready to Triage.</strong>
            Describe symptoms, show injuries, or upload medical reports (ECG, Prescriptions).
          </p>
          <div className="flex gap-2 opacity-50">
            <Activity className="w-4 h-4" />
            <Stethoscope className="w-4 h-4" />
            <HeartPulse className="w-4 h-4" />
          </div>
        </div>
      </div>
    );
  }

  if (isAnalyzing) {
    return (
       <div className="absolute top-4 right-4 z-20 w-full max-w-sm bg-black/80 backdrop-blur-xl border border-blue-500/30 rounded-xl p-6 shadow-[0_0_30px_rgba(59,130,246,0.2)]">
         <div className="flex flex-col items-center justify-center gap-4 py-8">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
              <FileSearch className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 text-blue-400" />
            </div>
            <p className="text-blue-200 font-mono text-sm animate-pulse">GEMINI 3 PRO ANALYZING...</p>
         </div>
       </div>
    );
  }

  if (!status) return null;

  const getSeverityConfig = (level: string) => {
    switch (level) {
      case 'EMERGENCY': 
        return {
          color: 'text-red-500',
          bg: 'bg-red-950/80',
          border: 'border-red-500',
          icon: Siren,
          shadow: 'shadow-[0_0_50px_rgba(239,68,68,0.3)]'
        };
      case 'MODERATE': 
        return {
          color: 'text-orange-500',
          bg: 'bg-orange-950/80',
          border: 'border-orange-500',
          icon: AlertTriangle,
          shadow: 'shadow-[0_0_30px_rgba(249,115,22,0.2)]'
        };
      case 'LOW': 
        return {
          color: 'text-emerald-500',
          bg: 'bg-emerald-950/80',
          border: 'border-emerald-500',
          icon: CheckCircle2,
          shadow: 'shadow-[0_0_30px_rgba(16,185,129,0.2)]'
        };
      default: 
        return {
          color: 'text-zinc-500',
          bg: 'bg-zinc-900/90',
          border: 'border-zinc-700',
          icon: Activity,
          shadow: ''
        };
    }
  };

  const config = getSeverityConfig(status.riskLevel);
  const Icon = config.icon;

  return (
    <div className="absolute top-4 right-4 z-20 w-full max-w-md flex flex-col gap-3 h-[calc(100vh-100px)] overflow-y-auto pb-10 scrollbar-hide">
      
      {/* Primary Triage Card */}
      <div className={`backdrop-blur-xl border-2 rounded-xl p-5 ${config.bg} ${config.border} ${config.shadow} transition-all duration-500`}>
        <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Icon className={`w-6 h-6 ${config.color} animate-pulse`} />
            <h2 className={`text-xl font-bold font-mono tracking-tight ${config.color}`}>
              {status.riskLevel} PRIORITY
            </h2>
          </div>
          {status.source === 'DEEP_SCAN' && (
             <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded border border-blue-500/30 font-mono">
               DEEP SCAN
             </span>
          )}
        </div>
        
        <div className="space-y-4">
          <div>
            <span className="text-xs uppercase font-bold text-white/50 block mb-1">Probable Condition</span>
            <p className="text-2xl font-bold text-white leading-none">{status.condition}</p>
          </div>

          <div className="bg-black/30 rounded-lg p-3 border border-white/5">
            <span className="text-xs uppercase font-bold text-white/50 block mb-1">Reasoning</span>
            <p className="text-sm text-zinc-300 leading-relaxed">{status.reasoning}</p>
          </div>
        </div>
      </div>

      {/* Action Plan */}
      <div className="bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-xl overflow-hidden shadow-xl">
        <div className="p-3 bg-zinc-800/50 border-b border-zinc-700 flex items-center gap-2">
           <Activity className="w-4 h-4 text-blue-400" />
           <span className="text-sm font-bold text-zinc-300 uppercase tracking-wider">Protocol</span>
        </div>
        
        <div className="p-5 space-y-5">
           {/* First Aid */}
           <div>
             <h3 className="text-sm font-medium text-emerald-400 mb-2 flex items-center gap-2">
               <HeartPulse className="w-4 h-4" /> Immediate Action
             </h3>
             <p className="text-sm text-zinc-100 bg-emerald-950/30 border border-emerald-900/50 p-3 rounded-lg">
               {status.immediateAction}
             </p>
           </div>

           {/* Hospital Urgency */}
           <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                 <span className="text-xs text-zinc-500 block mb-1">Disposition</span>
                 <div className={`text-sm font-bold ${status.hospitalUrgency === 'RUSH_TO_ER' ? 'text-red-500' : 'text-zinc-200'}`}>
                    {status.hospitalUrgency.replace(/_/g, ' ')}
                 </div>
              </div>
              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                 <span className="text-xs text-zinc-500 block mb-1">Department</span>
                 <div className="text-sm font-bold text-blue-300 flex items-center gap-1">
                    <Hospital className="w-3 h-3" />
                    {status.department}
                 </div>
              </div>
           </div>

           {/* Contraindications */}
           <div>
              <h3 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-2">
                <Ban className="w-4 h-4" /> Do NOT Do This
              </h3>
              <p className="text-xs text-zinc-300 italic border-l-2 border-red-900/50 pl-3">
                {status.contraindications}
              </p>
           </div>
        </div>
      </div>
    </div>
  );
};

export default StatusHUD;
