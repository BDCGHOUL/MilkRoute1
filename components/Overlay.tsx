
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
  return (
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-between p-6 sm:p-10 transition-all duration-700">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-black pointer-events-none" />
      
      {/* Background Animated Elements */}
      <div className="absolute top-1/4 left-1/4 w-48 sm:w-64 h-48 sm:h-64 bg-blue-600/10 blur-[100px] rounded-full animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-48 sm:w-64 h-48 sm:h-64 bg-red-600/10 blur-[100px] rounded-full animate-pulse delay-700" />

      {/* Top Section */}
      <div className="relative text-center w-full max-w-sm pt-8">
        <div className="bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full text-[8px] font-black text-blue-400 uppercase tracking-[0.3em] mb-4 mx-auto w-fit">
          Fleet Telemetry Core
        </div>
        <h1 className="text-5xl sm:text-6xl font-black tracking-tighter mb-2 italic leading-none">
          LOGISTICS <span className="text-blue-500">PRO</span>
        </h1>
        <div className="flex items-center justify-center gap-3 text-zinc-600 mono text-[9px] font-bold uppercase tracking-widest">
           <span>V6.2.8</span>
           <div className="w-1 h-1 rounded-full bg-zinc-800" />
           <span>GRID STABLE</span>
        </div>
      </div>

      {/* Center Card */}
      <div className="glass border-white/5 p-8 sm:p-10 rounded-[2.5rem] sm:rounded-[3rem] w-full max-w-sm shadow-2xl relative overflow-hidden flex flex-col my-auto">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/20 to-transparent opacity-50 blur-2xl" />
        
        <div className="flex justify-between items-center mb-8">
           <div className="flex flex-col">
              <h2 className={`text-4xl font-black tracking-tighter uppercase italic leading-none ${routeType === RouteType.VILLAGE ? 'text-red-500' : 'text-blue-500'}`}>
                {routeType === RouteType.VILLAGE ? 'Village' : 'Town'} Run
              </h2>
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mt-2 italic">
                 {new Date().toLocaleDateString('en-GB', { weekday: 'long' })} Protocol
              </p>
           </div>
           <Map size={32} className="text-zinc-800" />
        </div>

        <div className="space-y-4">
          <button 
            onClick={onStart}
            className={`w-full group relative flex items-center justify-between px-8 py-7 rounded-[2rem] font-black text-2xl tracking-tighter transition-all active:scale-95 shadow-2xl overflow-hidden ${routeType === RouteType.VILLAGE ? 'bg-red-600' : 'bg-blue-600'} text-white border-b-4 ${routeType === RouteType.VILLAGE ? 'border-red-800' : 'border-blue-800'}`}
          >
            <span className="relative z-10">{resumeIndex > 0 ? 'RESUME' : 'START SHIFT'}</span>
            <ChevronRight className="relative z-10 group-hover:translate-x-2 transition-transform" strokeWidth={3} />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
          </button>

          <button 
            onClick={onBriefing}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-white/5 border border-white/5 text-zinc-400 font-black text-[10px] uppercase tracking-widest active:scale-95"
          >
            <Sparkles size={14} className="text-blue-500" />
            Intelligence Briefing
          </button>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="flex flex-col items-center gap-6 pb-4 w-full">
        <button 
          onClick={onAdminToggle}
          className="flex items-center gap-3 px-6 py-3 rounded-2xl border border-white/5 bg-zinc-900/50 text-zinc-500 hover:text-white transition-all active:scale-95 group"
        >
          {isAdmin ? <ShieldCheck size={16} className="text-green-500" /> : <Shield size={16} />}
          <span className="text-[9px] font-black uppercase tracking-widest italic">
            {isAdmin ? 'Privileged Mode Active' : 'System Administration'}
          </span>
        </button>
        
        <div className="text-[7px] font-black text-zinc-800 uppercase tracking-[0.4em] text-center">
          Confidential • Telemetry Loop 0x82A • Cambridge Sector
        </div>
      </div>
    </div>
  );
};

export default Overlay;
