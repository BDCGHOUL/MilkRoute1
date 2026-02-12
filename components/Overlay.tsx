
import React from 'react';
import { RouteType } from '../types';
import { Shield, ShieldCheck, Sparkles, Map, ChevronRight } from 'lucide-react';

interface OverlayProps {
  routeType: RouteType;
  onStart: () => void;
  resumeIndex: number;
  isAdmin: boolean;
  onAdminToggle: () => void;
  onBriefing: () => void;
}

const Overlay: React.FC<OverlayProps> = ({ routeType, onStart, resumeIndex, isAdmin, onAdminToggle, onBriefing }) => {
  const isWeekend = new Date().getDay() === 6; // Saturday

  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center p-8 transition-all duration-700">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-black pointer-events-none" />
      
      {/* Background Animated Elements */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-red-600/10 blur-[120px] rounded-full animate-pulse delay-700" />

      <div className="mb-16 relative text-center">
        <div className="bg-blue-500/10 border border-blue-500/20 px-4 py-1 rounded-full text-[10px] font-black text-blue-400 uppercase tracking-[0.4em] mb-4 mx-auto w-fit">
          High Performance Fleet System
        </div>
        <h1 className="text-6xl font-black tracking-tighter mb-2 italic">
          LOGISTICS <span className="text-blue-500">PRO</span>
        </h1>
        <div className="flex items-center justify-center gap-3 text-zinc-500 mono text-xs font-bold uppercase tracking-widest">
           <span>VER 6.2.1</span>
           <div className="w-1 h-1 rounded-full bg-zinc-800" />
           <span>STABLE BUILD</span>
        </div>
      </div>

      <div className="glass border-white/5 p-10 rounded-[3rem] w-full max-w-md shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/20 to-transparent opacity-50 blur-2xl" />
        
        <div className="flex justify-between items-center mb-8">
           <div className="flex flex-col">
              <h2 className={`text-4xl font-black tracking-tighter uppercase italic ${routeType === RouteType.VILLAGE ? 'text-red-500' : 'text-blue-500'}`}>
                {routeType === RouteType.VILLAGE ? 'Village' : 'Town'} Run
              </h2>
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mt-1 italic">
                 {new Date().toLocaleDateString('en-GB', { weekday: 'long' })} Protocol
              </p>
           </div>
           <Map size={32} className="text-zinc-800" />
        </div>

        <div className="space-y-4">
          <button 
            onClick={onStart}
            className={`w-full group relative flex items-center justify-between px-8 py-7 rounded-[2rem] font-black text-2xl tracking-tighter transition-all active:scale-95 shadow-2xl overflow-hidden ${routeType === RouteType.VILLAGE ? 'bg-red-600 hover:bg-red-500 shadow-red-900/20' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/20'} text-white`}
          >
            <span className="relative z-10">{resumeIndex > 0 ? 'RESUME SESSION' : 'INITIALIZE SHIFT'}</span>
            <ChevronRight className="relative z-10 group-hover:translate-x-2 transition-transform" strokeWidth={3} />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
          </button>

          <button 
            onClick={onBriefing}
            className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl bg-white/5 border border-white/5 text-zinc-400 font-black text-xs uppercase tracking-widest hover:bg-white/10 hover:text-blue-400 transition-all active:scale-95"
          >
            <Sparkles size={16} className="text-blue-500" />
            Generate Intelligence Briefing
          </button>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
           <div className={`w-2 h-2 rounded-full animate-ping ${routeType === RouteType.VILLAGE ? 'bg-red-500' : 'bg-blue-500'}`} />
           <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest italic">Grid Connection Secure — Telemetry Live</span>
        </div>
      </div>

      <div className="absolute bottom-12 flex items-center gap-10">
        <button 
          onClick={onAdminToggle}
          className="flex items-center gap-3 px-6 py-3 rounded-2xl border border-white/5 bg-zinc-900/50 text-zinc-500 hover:text-white transition-all active:scale-95 group"
        >
          {isAdmin ? <ShieldCheck size={18} className="text-green-500" /> : <Shield size={18} className="group-hover:text-blue-500 transition-colors" />}
          <span className="text-[10px] font-black uppercase tracking-widest">
            {isAdmin ? 'System Admin' : 'Admin Login'}
          </span>
        </button>
      </div>

      <div className="absolute bottom-4 text-[8px] font-black text-zinc-800 uppercase tracking-[0.5em]">
        Proprietary Logistics Core • Cambridge Logistics Unit
      </div>
    </div>
  );
};

export default Overlay;
