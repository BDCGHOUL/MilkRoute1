
import React, { useState, useEffect, useRef } from 'react';
import { Stop, RouteType, RoadClosure } from './types.ts';
import { TOWN_STOPS, VILLAGE_STOPS } from './constants.ts';
import MapView from './components/MapView.tsx';
import Dashboard from './components/Dashboard.tsx';
import Overlay from './components/Overlay.tsx';
import Calculator from './components/Calculator.tsx';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Calculator as CalcIcon, Plus, Shield, Power, X, Lock,
  Construction, Zap, Loader2, Info, Sparkles, Navigation2, Calendar
} from 'lucide-react';

type ModalState = 'NONE' | 'ADMIN_LOGIN' | 'SIGN_OUT_CONFIRM' | 'ADD_STOP' | 'ADD_CLOSURE_FORM' | 'BRIEFING';

interface StopWithMeta extends Stop {
  originalIndex: number;
}

const App: React.FC = () => {
  const [isStarted, setIsStarted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isClosureMode, setIsClosureMode] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalState>('NONE');
  const [adminPassInput, setAdminPassInput] = useState('');
  const [index, setIndex] = useState(0);
  const [stops, setStops] = useState<StopWithMeta[]>([]);
  const [routeType, setRouteType] = useState<RouteType>(RouteType.TOWN);
  const [lastPos, setLastPos] = useState<[number, number] | null>(null);
  const [logicalPos, setLogicalPos] = useState<[number, number] | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [closures, setClosures] = useState<RoadClosure[]>([]);
  const [aiBriefing, setAiBriefing] = useState<{ text: string; strategy: string; sources: { title: string; uri: string }[] } | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const [showCalc, setShowCalc] = useState(false);

  // Form States
  const [newStopAddr, setNewStopAddr] = useState('');
  const [newClosureNote, setNewClosureNote] = useState('');
  const [tempClosurePos, setTempClosurePos] = useState<[number, number] | null>(null);

  // Initialize Route & Session
  useEffect(() => {
    const now = new Date();
    let bizDate = new Date(now);
    if (now.getHours() < 4) bizDate.setDate(now.getDate() - 1);
    const day = bizDate.getDay();
    const needsVillage = (day === 0 || day === 2 || day === 4);
    const targetType = needsVillage ? RouteType.VILLAGE : RouteType.TOWN;
    const baseStops = (needsVillage ? VILLAGE_STOPS : TOWN_STOPS).map((s, i) => ({ ...s, originalIndex: i }));
    
    setRouteType(targetType);
    
    const savedStops = localStorage.getItem('log_nav_stops_v6');
    const savedIdx = localStorage.getItem('log_nav_idx');
    const savedType = localStorage.getItem('log_nav_route_type');

    if (savedStops && savedType === targetType) {
      setStops(JSON.parse(savedStops));
      if (savedIdx) setIndex(Math.min(parseInt(savedIdx), JSON.parse(savedStops).length - 1));
    } else {
      setStops(baseStops);
      setIndex(0);
      localStorage.setItem('log_nav_route_type', targetType);
    }

    const savedClosures = localStorage.getItem('log_nav_closures');
    if (savedClosures) setClosures(JSON.parse(savedClosures));
    if (localStorage.getItem('adminSession') === 'active') setIsAdmin(true);
  }, []);

  // Sync GPS
  useEffect(() => {
    if (!isStarted || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setLastPos([pos.coords.latitude, pos.coords.longitude]),
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isStarted]);

  // Persist Progress
  useEffect(() => {
    if (isStarted) {
      localStorage.setItem('log_nav_idx', index.toString());
      localStorage.setItem('log_nav_stops_v6', JSON.stringify(stops));
    }
  }, [index, isStarted, stops]);

  const generateBriefing = async () => {
    setIsBriefingLoading(true);
    setActiveModal('BRIEFING');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentRouteNames = stops.slice(index, index + 20).map(s => s.addr).join(', ');
      
      const searchResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `URGENT: Analyze live road conditions and planned closures in Cambridge UK for tonight. 
        Focus on these locations: ${currentRouteNames}. 
        Provide a detailed report and a section titled "Best Route Strategy" with specific tactical advice on which streets to avoid and how to bypass them.`,
        config: { tools: [{ googleSearch: {} }] }
      });

      const fullText = searchResponse.text || "No reports found for this sector.";
      const strategyMatch = fullText.match(/Best Route Strategy:(.*)/si);
      const strategyText = strategyMatch ? strategyMatch[1].trim() : "Proceed with caution. No specific diversions found.";
      const reportText = fullText.split("Best Route Strategy:")[0].trim();

      // Second pass: Extract closure coordinates if possible for auto-marking
      const closureParser = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Based on this traffic report: "${fullText}", identify if any of these specific stops are likely blocked: ${JSON.stringify(stops.slice(index, index + 15))}. 
        If a stop or its immediate street is blocked, return it as a JSON array of {lat, lng, note}. Return [] if none.`,
        config: { responseMimeType: "application/json" }
      });

      try {
        const detected = JSON.parse(closureParser.text.trim());
        if (Array.isArray(detected) && detected.length > 0) {
          const today = new Date().toISOString().split('T')[0];
          const newClosures: RoadClosure[] = detected.map((dc: any) => ({
            id: `ai-${Date.now()}-${Math.random()}`,
            lat: dc.lat,
            lng: dc.lng,
            radius: 100,
            startDate: today,
            endDate: today,
            note: `AI DETECTED: ${dc.note}`
          }));
          setClosures(prev => [...prev, ...newClosures]);
          localStorage.setItem('log_nav_closures', JSON.stringify([...closures, ...newClosures]));
        }
      } catch (e) { /* ignore parse errors */ }

      setAiBriefing({ 
        text: reportText, 
        strategy: strategyText, 
        sources: (searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
          .map((c: any) => c.web).filter(Boolean)
      });
    } catch (e) {
      console.error("Briefing Error:", e);
      setAiBriefing({ 
        text: "Direct intel feed interrupted. Rely on local radio and high-visibility monitoring. System will retry on next Reroute.", 
        strategy: "Maintain standard sequence unless visual obstruction is encountered.", 
        sources: [] 
      });
    } finally {
      setIsBriefingLoading(false);
    }
  };

  const handleSignOut = () => {
    setIsStarted(false);
    setIndex(0);
    localStorage.removeItem('log_nav_idx');
    localStorage.removeItem('log_nav_stops_v6');
    localStorage.removeItem('log_nav_closures');
    setActiveModal('NONE');
    window.location.reload(); // Hard reset
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    setIsClosureMode(false);
    localStorage.removeItem('adminSession');
  };

  const handleAddStop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStopAddr) return;
    const current = lastPos || [52.205, 0.12];
    const newStop: StopWithMeta = {
      addr: newStopAddr,
      lat: current[0] + (Math.random() - 0.5) * 0.01,
      lng: current[1] + (Math.random() - 0.5) * 0.01,
      originalIndex: stops.length
    };
    setStops(prev => [...prev, newStop]);
    setNewStopAddr('');
    setActiveModal('NONE');
  };

  const handleAddClosure = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempClosurePos || !newClosureNote) return;
    const today = new Date().toISOString().split('T')[0];
    const newClosure: RoadClosure = {
      id: `man-${Date.now()}`,
      lat: tempClosurePos[0],
      lng: tempClosurePos[1],
      radius: 150,
      startDate: today,
      endDate: today,
      note: newClosureNote
    };
    const updated = [...closures, newClosure];
    setClosures(updated);
    localStorage.setItem('log_nav_closures', JSON.stringify(updated));
    setNewClosureNote('');
    setTempClosurePos(null);
    setActiveModal('NONE');
  };

  return (
    <div className="flex flex-col h-full w-full bg-black text-white overflow-hidden p-2 sm:p-3 gap-2 sm:gap-3 relative">
      {!isStarted && (
        <Overlay 
          routeType={routeType} 
          onStart={() => setIsStarted(true)} 
          resumeIndex={index} 
          isAdmin={isAdmin} 
          onAdminToggle={() => isAdmin ? handleAdminLogout() : setActiveModal('ADMIN_LOGIN')} 
          onBriefing={generateBriefing} 
        />
      )}

      {/* Header */}
      <div className="flex justify-between items-center h-14 shrink-0 px-4 z-[100] glass rounded-2xl border-white/10 shadow-lg">
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-blue-500 tracking-[0.4em] uppercase leading-none mb-1">Logistics Core</span>
          <span className="text-sm font-black mono text-zinc-200">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="flex gap-2">
            {isAdmin && <button onClick={handleAdminLogout} className="p-2.5 text-orange-500 bg-orange-500/10 rounded-xl border border-orange-500/20 active:scale-95 shadow-lg"><Lock size={18} /></button>}
            <button onClick={() => setShowCalc(true)} className="p-2.5 text-yellow-500 bg-yellow-500/10 rounded-xl border border-yellow-500/20 active:scale-95 shadow-lg"><CalcIcon size={18} /></button>
            <button onClick={() => setActiveModal('BRIEFING')} className="p-2.5 text-blue-500 bg-blue-500/10 rounded-xl border border-blue-500/20 active:scale-95 shadow-lg"><Info size={18} /></button>
            <button onClick={() => setActiveModal('SIGN_OUT_CONFIRM')} className="p-2.5 text-red-500 bg-red-500/10 rounded-xl border border-red-500/20 active:scale-95 shadow-lg"><Power size={18} /></button>
        </div>
      </div>

      <Dashboard 
        index={index} 
        stops={stops} 
        lastPos={logicalPos || lastPos} 
        isArrived={false} 
        arrivalProgress={0} 
        onSkip={() => setIndex(prev => prev + 1)} 
        onBack={() => setIndex(Math.max(0, index - 1))} 
        closures={closures} 
      />

      <div className="flex-1 relative rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-2xl min-h-0">
        <MapView 
          stops={stops} 
          index={index} 
          routeType={routeType} 
          lastPos={logicalPos || lastPos} 
          isAdmin={isAdmin} 
          onStopsUpdate={(s) => { setStops(s as StopWithMeta[]); }} 
          closures={closures} 
          onMapClick={(lat, lng) => { 
            if(isAdmin && isClosureMode) { 
              setTempClosurePos([lat, lng]);
              setActiveModal('ADD_CLOSURE_FORM');
              setIsClosureMode(false);
            } 
          }} 
        />
        
        {/* Admin floating controls */}
        {isAdmin && (
          <div className="absolute top-4 right-4 flex flex-col gap-3 z-[1000]">
            <button 
              onClick={() => setIsClosureMode(!isClosureMode)} 
              className={`w-12 h-12 rounded-2xl border-2 flex items-center justify-center shadow-2xl transition-all ${isClosureMode ? 'bg-red-600 border-white scale-110 shadow-red-500/50' : 'bg-black/80 backdrop-blur-md border-white/20'}`}
              title="Add Road Closure"
            >
              <Construction size={22} className={isClosureMode ? 'animate-pulse' : 'text-zinc-400'} />
            </button>
            <button 
              onClick={() => setActiveModal('ADD_STOP')} 
              className="w-12 h-12 bg-white text-black rounded-2xl flex items-center justify-center shadow-2xl active:scale-90 border-2 border-white/20"
              title="Add Manual Stop"
            >
              <Plus size={26} />
            </button>
          </div>
        )}

        {/* Navigation Bottom Deck */}
        <div className="absolute bottom-4 left-4 right-4 flex gap-3 z-[1000]">
           <button 
             onClick={() => { const s = stops[index]; if (s) window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, '_blank'); }} 
             className="flex-1 bg-blue-600 text-white h-16 rounded-2xl font-black text-sm pulse-accent shadow-2xl active:scale-95 uppercase tracking-widest italic flex items-center justify-center gap-3 border-b-4 border-blue-800"
           >
             <Navigation2 size={22} fill="currentColor" />
             Launch Navigation
           </button>
           <button 
             onClick={async () => { setIsOptimizing(true); await generateBriefing(); setIsOptimizing(false); }} 
             className="px-6 bg-black/90 backdrop-blur-md border border-white/20 text-white h-16 rounded-2xl font-black text-[10px] flex items-center gap-2 shadow-xl active:scale-95 uppercase tracking-widest border-b-4 border-zinc-800"
           >
             {isOptimizing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={14} className="text-yellow-400" />} 
             AI Reroute
           </button>
        </div>
      </div>

      {/* MODALS */}
      
      {/* Road Intel Modal */}
      {activeModal === 'BRIEFING' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl">
          <div className="glass border-blue-500/20 rounded-[2.5rem] p-8 sm:p-10 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden">
             <div className="flex items-center gap-4 mb-8 shrink-0">
                <div className="bg-blue-600/20 p-4 rounded-2xl border border-blue-500/30"><Sparkles size={32} className="text-blue-500" /></div>
                <div>
                  <h2 className="text-3xl font-black uppercase italic tracking-tighter text-white">Road Intel</h2>
                  <p className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">Autonomous Grid Scanning</p>
                </div>
             </div>
             {isBriefingLoading ? (
               <div className="flex flex-col items-center py-24 gap-10 grow justify-center">
                  <div className="relative">
                    <Loader2 size={64} className="text-blue-500 animate-spin" />
                    <Zap size={24} className="text-yellow-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <div className="text-center space-y-3">
                    <p className="text-zinc-300 font-black uppercase tracking-[0.3em] text-xs">Parsing Infrastructure Logs</p>
                    <p className="text-zinc-600 font-bold text-[9px] uppercase tracking-widest">Cross-referencing satellite data...</p>
                  </div>
               </div>
             ) : (
               <>
                 <div className="flex-1 overflow-y-auto pr-3 no-scrollbar space-y-8">
                   <div className="space-y-4">
                      <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Infrastructure Logs
                      </div>
                      <div className="text-lg font-medium text-zinc-200 leading-relaxed italic border-l-2 border-zinc-800 pl-5">
                        {aiBriefing?.text}
                      </div>
                   </div>
                   <div className="space-y-4">
                      <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2">
                         <Zap size={10} className="fill-blue-500 text-blue-500" /> AI Strategic Analysis
                      </div>
                      <div className="bg-blue-600/10 border border-blue-500/30 rounded-2xl p-6 text-blue-100 font-black text-xl italic tracking-tighter leading-tight shadow-xl">
                         {aiBriefing?.strategy}
                      </div>
                   </div>
                 </div>
                 <div className="mt-8 pt-6 border-t border-white/10 shrink-0">
                   <button onClick={() => setActiveModal('NONE')} className="w-full bg-white text-black py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">Acknowledge Intel</button>
                 </div>
               </>
             )}
          </div>
        </div>
      )}

      {/* Add Stop Modal */}
      {activeModal === 'ADD_STOP' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass rounded-[2.5rem] p-8 w-full max-w-sm border-white/10 shadow-3xl">
            <h2 className="text-2xl font-black uppercase italic text-white mb-6 flex items-center gap-3">
              <Plus className="text-blue-500" /> Add Stop
            </h2>
            <form onSubmit={handleAddStop}>
              <div className="space-y-4">
                <input 
                  type="text" 
                  value={newStopAddr} 
                  onChange={(e) => setNewStopAddr(e.target.value)} 
                  placeholder="STREET ADDRESS / UNIT"
                  className="w-full bg-black border-2 border-zinc-800 rounded-2xl py-5 px-6 text-xl font-bold text-white outline-none focus:border-blue-500"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setActiveModal('NONE')} className="flex-1 bg-zinc-900 text-zinc-400 py-5 rounded-2xl font-black uppercase text-xs">Cancel</button>
                  <button type="submit" className="flex-[2] bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-sm shadow-lg active:scale-95">Add to Route</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Closure Form */}
      {activeModal === 'ADD_CLOSURE_FORM' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass rounded-[2.5rem] p-8 w-full max-w-sm border-white/10 shadow-3xl">
            <h2 className="text-2xl font-black uppercase italic text-red-500 mb-6 flex items-center gap-3">
              <Construction className="text-red-500" /> Set Closure
            </h2>
            <form onSubmit={handleAddClosure}>
              <div className="space-y-4">
                <textarea 
                  value={newClosureNote} 
                  onChange={(e) => setNewClosureNote(e.target.value)} 
                  placeholder="CLOSURE REASON (E.G. GAS LEAK, NIGHT WORKS)"
                  className="w-full bg-black border-2 border-zinc-800 rounded-2xl py-4 px-6 text-sm font-bold text-white outline-none focus:border-red-500 h-32"
                  autoFocus
                />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setActiveModal('NONE')} className="flex-1 bg-zinc-900 text-zinc-400 py-5 rounded-2xl font-black uppercase text-xs">Abort</button>
                  <button type="submit" className="flex-[2] bg-red-600 text-white py-5 rounded-2xl font-black uppercase text-sm shadow-lg active:scale-95">Mark Blockage</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Exit Shift Modal */}
      {activeModal === 'SIGN_OUT_CONFIRM' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/95 backdrop-blur-lg">
          <div className="glass border-red-500/20 rounded-[2.5rem] p-10 w-full max-w-xs text-center shadow-2xl">
            <div className="bg-red-500/10 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-red-500/20 text-red-500">
              <Power size={32} />
            </div>
            <h2 className="text-3xl font-black text-white mb-2 uppercase italic tracking-tighter">End Shift?</h2>
            <p className="text-zinc-500 font-medium mb-10 text-sm">Session and cached telemetry will be purged.</p>
            <div className="flex flex-col gap-4">
              <button onClick={handleSignOut} className="w-full bg-red-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 uppercase italic tracking-tighter">Terminate Session</button>
              <button onClick={() => setActiveModal('NONE')} className="w-full bg-white/5 text-zinc-400 py-4 rounded-2xl font-black text-xs uppercase tracking-widest">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Login Modal */}
      {activeModal === 'ADMIN_LOGIN' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass rounded-[2.5rem] p-10 w-full max-w-xs text-center border-white/10 shadow-3xl">
            <h2 className="text-xl font-black uppercase tracking-[0.2em] text-zinc-500 mb-8">Access Key</h2>
            <form onSubmit={(e) => { e.preventDefault(); if(adminPassInput === "5371") { setIsAdmin(true); localStorage.setItem('adminSession', 'active'); setActiveModal('NONE'); setAdminPassInput(''); } else { setAdminPassInput(''); } }}>
              <input type="password" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} className="w-full bg-black border-2 border-zinc-800 rounded-3xl py-6 text-center text-4xl font-black mb-8 mono focus:border-blue-500 outline-none transition-all shadow-inner" autoFocus />
              <button type="submit" className="w-full bg-white text-black py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 shadow-xl">Connect Hub</button>
            </form>
          </div>
        </div>
      )}

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
    </div>
  );
};

export default App;
