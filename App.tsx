
import React, { useState, useEffect, useRef } from 'react';
import { Stop, RouteType, RoadClosure } from './types.ts';
import { TOWN_STOPS, VILLAGE_STOPS, TRIGGER_DIST } from './constants.ts';
import MapView from './components/MapView.tsx';
import Dashboard from './components/Dashboard.tsx';
import Overlay from './components/Overlay.tsx';
import Calculator from './components/Calculator.tsx';
import { GoogleGenAI } from "@google/genai";
import { 
  Calculator as CalcIcon, Plus, Power, Lock,
  Construction, Zap, Loader2, Info, Sparkles, Navigation2
} from 'lucide-react';

type ModalState = 'NONE' | 'ADMIN_LOGIN' | 'SIGN_OUT_CONFIRM' | 'ADD_STOP' | 'ADD_CLOSURE_FORM' | 'BRIEFING';

interface StopWithMeta extends Stop {
  originalIndex: number;
}

const getHaversineDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

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
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [closures, setClosures] = useState<RoadClosure[]>([]);
  const [aiBriefing, setAiBriefing] = useState<{ text: string; strategy: string; sources: { title: string; uri: string }[] } | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);
  const [showCalc, setShowCalc] = useState(false);

  // Arrival Logic States
  const [isArrived, setIsArrived] = useState(false);
  const [arrivalProgress, setArrivalProgress] = useState(0);
  const [activeArrivalIndex, setActiveArrivalIndex] = useState<number | null>(null);
  const arrivalTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  // Form States
  const [newStopAddr, setNewStopAddr] = useState('');
  const [newClosureNote, setNewClosureNote] = useState('');
  const [tempClosurePos, setTempClosurePos] = useState<[number, number] | null>(null);

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
    // Reset Admin on reload
    setIsAdmin(false);
  }, []);

  // Proximity Loop - Decoupled to avoid stuck timers
  useEffect(() => {
    if (!isStarted || !lastPos || index >= stops.length) return;

    const nearbyIdx = stops.findIndex((s, i) => 
      i >= index && getHaversineDist(lastPos[0], lastPos[1], s.lat, s.lng) < TRIGGER_DIST
    );

    if (nearbyIdx !== -1) {
      if (activeArrivalIndex !== nearbyIdx) {
        setActiveArrivalIndex(nearbyIdx);
        setIsArrived(true);
        setArrivalProgress(0);
        startTimeRef.current = Date.now();

        if (arrivalTimerRef.current) clearInterval(arrivalTimerRef.current);
        
        arrivalTimerRef.current = window.setInterval(() => {
          const now = Date.now();
          const start = startTimeRef.current || now;
          const elapsed = now - start;
          const progress = Math.min((elapsed / 10000) * 100, 100);
          setArrivalProgress(progress);

          if (elapsed >= 10000) {
            handleStopCompleted(nearbyIdx);
          }
        }, 100);
      }
    } else {
      if (isArrived) {
        setIsArrived(false);
        setActiveArrivalIndex(null);
        setArrivalProgress(0);
        if (arrivalTimerRef.current) {
          clearInterval(arrivalTimerRef.current);
          arrivalTimerRef.current = null;
        }
      }
    }
  }, [lastPos, isStarted, index, stops]);

  const handleStopCompleted = (completedIdx: number) => {
    if (arrivalTimerRef.current) {
      clearInterval(arrivalTimerRef.current);
      arrivalTimerRef.current = null;
    }
    setIsArrived(false);
    setArrivalProgress(0);
    setActiveArrivalIndex(null);
    setIndex(completedIdx + 1);
  };

  useEffect(() => {
    if (!isStarted || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setLastPos([pos.coords.latitude, pos.coords.longitude]),
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isStarted]);

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
      const currentRouteNames = stops.slice(index, index + 10).map(s => s.addr).join(', ');
      
      let searchResponse;
      try {
        searchResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Analyze live road conditions in Cambridge UK. Focus: ${currentRouteNames}. Provide a "Best Route Strategy" section.`,
          config: { tools: [{ googleSearch: {} }] }
        });
      } catch (searchErr) {
        searchResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Provide tactical route strategy for a logistics driver in Cambridge UK (${routeType}) at night.`,
        });
      }

      const fullText = searchResponse.text || "Direct intel unreachable.";
      const strategyMatch = fullText.match(/Best Route Strategy:(.*)/si);
      const strategyText = strategyMatch ? strategyMatch[1].trim() : "Standard routing suggested.";
      const reportText = fullText.split("Best Route Strategy:")[0].trim();

      setAiBriefing({ 
        text: reportText, 
        strategy: strategyText, 
        sources: (searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
          .map((c: any) => c.web).filter(Boolean)
      });
    } catch (e) {
      setAiBriefing({ text: "System telemetry interrupted.", strategy: "Maintain visual confirmation.", sources: [] });
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
    localStorage.removeItem('adminSession');
    setActiveModal('NONE');
    window.location.reload();
  };

  const handleAddStop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStopAddr) return;
    const current = lastPos || [52.205, 0.12];
    const newStop: StopWithMeta = {
      addr: newStopAddr,
      lat: current[0] + (Math.random() - 0.5) * 0.002,
      lng: current[1] + (Math.random() - 0.5) * 0.002,
      originalIndex: stops.length
    };
    const updatedStops = [...stops.slice(0, index + 1), newStop, ...stops.slice(index + 1)];
    setStops(updatedStops);
    localStorage.setItem('log_nav_stops_v6', JSON.stringify(updatedStops));
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
    <div className="flex flex-col h-full w-full bg-[#030303] items-center overflow-hidden">
      <div className="flex flex-col h-full w-full max-w-[650px] bg-black text-white p-2 sm:p-4 gap-2 sm:gap-4 relative shadow-[0_0_150px_rgba(0,0,0,1)] border-x border-white/5">
        
        {!isStarted && (
          <Overlay 
            routeType={routeType} 
            onStart={() => setIsStarted(true)} 
            resumeIndex={index} 
            isAdmin={isAdmin} 
            onAdminToggle={() => isAdmin ? setIsAdmin(false) : setActiveModal('ADMIN_LOGIN')} 
            onBriefing={generateBriefing} 
          />
        )}

        <div className="flex justify-between items-center h-16 shrink-0 px-4 z-[100] glass rounded-2xl border-white/10 shadow-xl">
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-blue-500 tracking-[0.4em] uppercase leading-none mb-1 italic">Logistics Core</span>
            <span className="text-sm font-black mono text-zinc-100 italic">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="flex gap-2">
              {isAdmin && <button onClick={() => setIsAdmin(false)} className="p-3 text-orange-500 bg-orange-500/10 rounded-xl border border-orange-500/20 active:scale-95"><Lock size={20} /></button>}
              <button onClick={() => setShowCalc(true)} className="p-3 text-yellow-400 bg-yellow-400/10 rounded-xl border border-yellow-400/20 active:scale-95 shadow-lg"><CalcIcon size={20} /></button>
              <button onClick={() => setActiveModal('BRIEFING')} className="p-3 text-blue-500 bg-blue-500/10 rounded-xl border border-blue-500/20 active:scale-95"><Info size={20} /></button>
              <button onClick={() => setActiveModal('SIGN_OUT_CONFIRM')} className="p-3 text-red-500 bg-red-500/10 rounded-xl border border-red-500/20 active:scale-95"><Power size={20} /></button>
          </div>
        </div>

        <Dashboard 
          index={index} 
          stops={stops} 
          lastPos={lastPos} 
          isArrived={isArrived} 
          arrivalProgress={arrivalProgress} 
          onSkip={() => handleStopCompleted(activeArrivalIndex ?? index)} 
          onBack={() => setIndex(Math.max(0, index - 1))} 
          closures={closures} 
        />

        <div className="flex-1 relative rounded-[2.5rem] overflow-hidden border border-zinc-800 bg-zinc-950 shadow-inner min-h-0">
          <MapView 
            stops={stops} 
            index={index} 
            routeType={routeType} 
            lastPos={lastPos} 
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
          
          {isClosureMode && <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[500]"><div className="w-14 h-14 border-2 border-red-500 rounded-full flex items-center justify-center animate-pulse shadow-[0_0_30px_rgba(239,68,68,0.4)]"><div className="w-2 h-2 bg-red-500 rounded-full"/></div></div>}

          {isAdmin && (
            <div className="absolute top-6 right-6 flex flex-col gap-4 z-[1000]">
              <button 
                onClick={() => setIsClosureMode(!isClosureMode)} 
                className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center shadow-2xl transition-all ${isClosureMode ? 'bg-red-600 border-white scale-110' : 'bg-black/90 backdrop-blur-md border-white/20'}`}
              >
                <Construction size={24} className={isClosureMode ? 'animate-pulse text-white' : 'text-zinc-400'} />
              </button>
              <button 
                onClick={() => setActiveModal('ADD_STOP')} 
                className="w-14 h-14 bg-white text-black rounded-2xl flex items-center justify-center shadow-2xl active:scale-90 border-2 border-white/20"
              >
                <Plus size={28} />
              </button>
            </div>
          )}

          <div className="absolute bottom-6 left-6 right-6 flex gap-4 z-[1000]">
             <button 
               onClick={() => { const s = stops[index]; if (s) window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, '_blank'); }} 
               className="flex-1 bg-blue-600 text-white h-16 rounded-2xl font-black text-sm shadow-2xl active:scale-95 uppercase tracking-widest italic flex items-center justify-center gap-3 border-b-4 border-blue-800 transition-transform"
             >
               <Navigation2 size={24} fill="currentColor" />
               Launch Navigation
             </button>
             <button 
               onClick={async () => { setIsOptimizing(true); await generateBriefing(); setIsOptimizing(false); }} 
               className="px-6 bg-zinc-900/95 backdrop-blur-md border border-white/10 text-white h-16 rounded-2xl font-black text-[10px] flex items-center gap-2 shadow-xl active:scale-95 uppercase tracking-widest border-b-4 border-zinc-800"
             >
               {isOptimizing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} className="text-yellow-400" />} 
               AI Reroute
             </button>
          </div>
        </div>

        {activeModal === 'ADMIN_LOGIN' && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="glass rounded-[2.5rem] p-10 w-full max-w-xs text-center border-white/10 shadow-3xl">
              <h2 className="text-xl font-black uppercase tracking-[0.2em] text-zinc-500 mb-8 italic">Access Key</h2>
              <form onSubmit={(e) => { e.preventDefault(); if(adminPassInput === "5371") { setIsAdmin(true); setActiveModal('NONE'); setAdminPassInput(''); } else { setAdminPassInput(''); } }}>
                <input type="password" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} className="w-full bg-black border-2 border-zinc-800 rounded-3xl py-6 text-center text-4xl font-black mb-8 mono focus:border-blue-500 outline-none shadow-inner" autoFocus />
                <button type="submit" className="w-full bg-white text-black py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 shadow-xl">Connect Hub</button>
              </form>
            </div>
          </div>
        )}

        {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>
    </div>
  );
};

export default App;
