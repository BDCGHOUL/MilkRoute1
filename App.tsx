
import React, { useState, useEffect, useRef } from 'react';
import { Stop, RouteType, RoadClosure } from './types.ts';
import { TOWN_STOPS, VILLAGE_STOPS, TRIGGER_DIST } from './constants.ts';
import MapView from './components/MapView.tsx';
import Dashboard from './components/Dashboard.tsx';
import Overlay from './components/Overlay.tsx';
import Calculator from './components/Calculator.tsx';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Calculator as CalcIcon, Plus, Shield, Power, X, 
  Construction, Calendar, Trash2, Zap, CheckCircle2, Navigation2,
  Sparkles, Loader2, Info
} from 'lucide-react';

type ModalState = 'NONE' | 'ADMIN_LOGIN' | 'SIGN_OUT_CONFIRM' | 'ADD_STOP' | 'CLOSURE_MANAGER' | 'ADD_CLOSURE_FORM' | 'BRIEFING';

interface StopWithMeta extends Stop {
  originalIndex: number;
}

const App: React.FC = () => {
  const [isStarted, setIsStarted] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isClosureMode, setIsClosureMode] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalState>('NONE');
  const [adminPassInput, setAdminPassInput] = useState('');
  const [newStopName, setNewStopName] = useState('');
  const [index, setIndex] = useState(0);
  const [stops, setStops] = useState<StopWithMeta[]>([]);
  const [routeType, setRouteType] = useState<RouteType>(RouteType.TOWN);
  
  const [lastPos, setLastPos] = useState<[number, number] | null>(null);
  const [logicalPos, setLogicalPos] = useState<[number, number] | null>(null);
  
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [showCalc, setShowCalc] = useState(false);
  const [arrivalProgress, setArrivalProgress] = useState(0);
  const [isArrived, setIsArrived] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  
  const [closures, setClosures] = useState<RoadClosure[]>([]);
  const [tempClosurePos, setTempClosurePos] = useState<[number, number] | null>(null);
  const [closureDates, setClosureDates] = useState({ start: '', end: '', note: '' });

  const [aiBriefing, setAiBriefing] = useState<{ text: string; sources: { title: string; uri: string }[] } | null>(null);
  const [isBriefingLoading, setIsBriefingLoading] = useState(false);

  const dwellTimerRef = useRef<number | null>(null);

  const isClosureActive = (c: RoadClosure) => {
    const today = new Date().toISOString().split('T')[0];
    return today >= c.startDate && today <= c.endDate;
  };

  useEffect(() => {
    const now = new Date();
    let bizDate = new Date(now);
    if (now.getHours() < 4) bizDate.setDate(now.getDate() - 1);
    
    const day = bizDate.getDay();
    const currentNightNeedsVillage = (day === 0 || day === 2 || day === 4);
    const targetType = currentNightNeedsVillage ? RouteType.VILLAGE : RouteType.TOWN;
    const baseStops = currentNightNeedsVillage ? [...VILLAGE_STOPS] : [...TOWN_STOPS];
    
    setRouteType(targetType);
    
    const savedStops = localStorage.getItem('log_nav_stops_v6');
    const savedType = localStorage.getItem('log_nav_route_type');
    const savedIdx = localStorage.getItem('log_nav_idx');

    if (savedStops && savedType === targetType) {
      setStops(JSON.parse(savedStops));
      if (savedIdx) setIndex(Math.min(parseInt(savedIdx), JSON.parse(savedStops).length - 1));
    } else {
      const stopsWithMeta = baseStops.map((s, i) => ({ ...s, originalIndex: i }));
      setStops(stopsWithMeta);
      setIndex(0);
      localStorage.setItem('log_nav_idx', '0');
      localStorage.setItem('log_nav_route_type', targetType);
    }

    const savedClosures = localStorage.getItem('log_nav_closures');
    if (savedClosures) setClosures(JSON.parse(savedClosures));

    if (localStorage.getItem('adminSession') === 'active') setIsAdmin(true);
  }, []);

  useEffect(() => {
    if (isStarted && lastPos && !logicalPos) {
      setLogicalPos(lastPos);
    }
  }, [isStarted, lastPos, logicalPos]);

  useEffect(() => {
    if (stops.length > 0) {
      localStorage.setItem('log_nav_stops_v6', JSON.stringify(stops));
      localStorage.setItem('log_nav_route_type', routeType);
    }
  }, [stops, routeType]);

  useEffect(() => {
    localStorage.setItem('log_nav_closures', JSON.stringify(closures));
  }, [closures]);

  useEffect(() => {
    if (!isStarted || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLastPos([pos.coords.latitude, pos.coords.longitude]);
        setGpsAccuracy(pos.coords.accuracy);
      },
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isStarted]);

  const generateBriefing = async () => {
    setIsBriefingLoading(true);
    setActiveModal('BRIEFING');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentRouteStops = stops.slice(index, index + 15);
      const streetNames = currentRouteStops.map(s => s.addr).join(', ');
      
      const searchResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Search official Cambridgeshire roadwork portals and live news for road closures or heavy delays in Cambridge. 
        Focus strictly on the following streets: ${streetNames}. 
        Provide a detailed driver summary and advice on the best way to complete the route (e.g., skip specific stops, approach from the north, etc.). 
        Identify if any of these specific streets are explicitly closed.`,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });

      const briefingText = searchResponse.text || "No specific roadworks reported on your route.";
      const groundingChunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = groundingChunks
        .map((chunk: any) => chunk.web)
        .filter(Boolean)
        .map((web: any) => ({ title: web.title, uri: web.uri }));

      // Step 2: Auto-parse closures from text into data markers
      const parserResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Based on this report: "${briefingText}", identify coordinates of blocked stops. 
        STOPS: ${JSON.stringify(currentRouteStops.map(s => ({ addr: s.addr, lat: s.lat, lng: s.lng })))}
        Return a JSON array of {lat, lng, note} for actual blockages.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lat: { type: Type.NUMBER },
                lng: { type: Type.NUMBER },
                note: { type: Type.STRING }
              },
              required: ["lat", "lng", "note"]
            }
          }
        }
      });

      let detectedClosures: any[] = [];
      try {
        detectedClosures = JSON.parse(parserResponse.text.trim());
      } catch (e) {
        console.error("Closure parsing error", e);
      }

      if (detectedClosures.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const newClosures: RoadClosure[] = detectedClosures.map(dc => ({
          id: 'auto-' + Math.random().toString(36).substr(2, 9),
          lat: dc.lat,
          lng: dc.lng,
          radius: 150,
          startDate: today,
          endDate: today,
          note: `AI DETECTED: ${dc.note}`
        }));
        // Merge without duplicates
        setClosures(prev => [...prev.filter(p => !newClosures.some(n => Math.abs(n.lat - p.lat) < 0.0001)), ...newClosures]);
      }

      setAiBriefing({ text: briefingText, sources: sources });
    } catch (e) {
      setAiBriefing({ text: "Intel system currently offline. Use manual grid monitoring.", sources: [] });
    } finally {
      setIsBriefingLoading(false);
    }
  };

  const getDist = (l1: number, n1: number, l2: number, n2: number) => {
    const R = 6371000;
    const dLat = (l2 - l1) * Math.PI / 180;
    const dLon = (n2 - n1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(l1 * Math.PI / 180) * Math.cos(l2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (!lastPos || stops.length === 0 || index >= stops.length || isArrived) return;
    const currentStop = stops[index];
    const distance = getDist(lastPos[0], lastPos[1], currentStop.lat, currentStop.lng);

    if (distance < TRIGGER_DIST) {
      setIsArrived(true);
      let progress = 0;
      if (dwellTimerRef.current) clearInterval(dwellTimerRef.current);
      dwellTimerRef.current = window.setInterval(() => {
        progress += 2;
        setArrivalProgress(progress);
        if (progress >= 100) {
          clearInterval(dwellTimerRef.current!);
          setArrivalProgress(0);
          setIsArrived(false);
          const finishedStop = stops[index];
          setLogicalPos([finishedStop.lat, finishedStop.lng]);
          setIndex(prev => {
            const next = prev + 1;
            localStorage.setItem('log_nav_idx', next.toString());
            return next;
          });
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
      }, 100);
    }
  }, [lastPos, index, stops, isArrived]);

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassInput === "5371") {
      setIsAdmin(true);
      localStorage.setItem('adminSession', 'active');
      setActiveModal('NONE');
    } else {
      alert("UNAUTHORIZED ACCESS");
      setAdminPassInput('');
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (isAdmin && isClosureMode) {
      setTempClosurePos([lat, lng]);
      setActiveModal('ADD_CLOSURE_FORM');
      setClosureDates({ start: new Date().toISOString().split('T')[0], end: new Date().toISOString().split('T')[0], note: '' });
      setIsClosureMode(false);
    }
  };

  const saveClosure = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempClosurePos) {
      setClosures([...closures, { id: Math.random().toString(36).substr(2, 9), lat: tempClosurePos[0], lng: tempClosurePos[1], radius: 100, startDate: closureDates.start, endDate: closureDates.end, note: closureDates.note }]);
      setActiveModal('NONE');
      setTempClosurePos(null);
    }
  };

  const optimizeRemainingRoute = async () => {
    setIsOptimizing(true);
    const activeCurrentClosures = closures.filter(isClosureActive);
    const done = [...stops.slice(0, index)];
    const remaining = [...stops.slice(index)];
    const isBlocked = (s: Stop) => activeCurrentClosures.some(c => getDist(s.lat, s.lng, c.lat, c.lng) < 200);
    const clear = remaining.filter(s => !isBlocked(s)).sort((a, b) => a.originalIndex - b.originalIndex);
    const blocked = remaining.filter(s => isBlocked(s)).sort((a, b) => a.originalIndex - b.originalIndex);
    setStops([...done, ...clear, ...blocked]);
    await new Promise(r => setTimeout(r, 800));
    setIsOptimizing(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-black text-white overflow-hidden p-3 gap-3 relative">
      {!isStarted && <Overlay routeType={routeType} onStart={() => setIsStarted(true)} resumeIndex={index} isAdmin={isAdmin} onAdminToggle={() => isAdmin ? (setIsAdmin(false), localStorage.removeItem('adminSession')) : setActiveModal('ADMIN_LOGIN')} onBriefing={generateBriefing} />}

      <div className="flex justify-between items-center h-14 flex-shrink-0 px-3 z-[50] glass rounded-2xl">
        <div className="flex flex-col justify-center">
          <span className="text-[9px] uppercase tracking-[0.4em] text-blue-500 font-black">LOGISTICS PRO V6</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-black mono">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
        <div className="flex gap-4">
            <button onClick={() => setActiveModal('BRIEFING')} className="p-2 text-zinc-500 hover:text-blue-400 active:scale-95"><Info size={20} /></button>
            <button onClick={() => setActiveModal('SIGN_OUT_CONFIRM')} className="p-2 text-red-500 active:scale-95"><Power size={20} /></button>
        </div>
      </div>

      <Dashboard index={index} stops={stops} lastPos={logicalPos || lastPos} isArrived={isArrived} arrivalProgress={arrivalProgress} onSkip={() => setIndex(index + 1)} onBack={() => setIndex(Math.max(0, index - 1))} closures={closures} />

      <div className="flex-1 relative rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-2xl">
        <MapView stops={stops} index={index} routeType={routeType} lastPos={logicalPos || lastPos} isAdmin={isAdmin} onStopsUpdate={(s) => setStops(s as StopWithMeta[])} closures={closures} onMapClick={handleMapClick} />
        
        <div className="absolute top-6 right-6 flex flex-col gap-3 z-[1000] items-end">
           <button onClick={() => { const s = stops[index]; if (s) window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, '_blank'); }} className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-sm pulse-accent shadow-2xl active:scale-95">LAUNCH NAVIGATION</button>
           <button onClick={optimizeRemainingRoute} disabled={isOptimizing} className="px-8 py-4 bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-2xl font-black text-xs flex items-center gap-2 shadow-xl active:scale-95">{isOptimizing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} className="text-yellow-400" />} RE-ROUTE AI</button>
        </div>
      </div>

      {isAdmin && (
        <div className="fixed bottom-28 right-8 flex flex-col gap-4 z-[2000]">
          <button onClick={() => setIsClosureMode(!isClosureMode)} className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center shadow-2xl active:scale-90 transition-all ${isClosureMode ? 'bg-red-600 border-white' : 'bg-zinc-900 border-zinc-800'}`}><Construction size={22} /></button>
          <button onClick={() => setActiveModal('ADD_STOP')} className="w-14 h-14 bg-white text-black rounded-2xl flex items-center justify-center shadow-2xl active:scale-90"><Plus size={32} /></button>
        </div>
      )}

      {/* AI Intel Briefing Modal */}
      {activeModal === 'BRIEFING' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl">
          <div className="glass border-blue-500/20 rounded-[2.5rem] p-10 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-blue-500/50" />
             <div className="flex items-center gap-3 mb-8 shrink-0">
                <div className="bg-blue-500/20 p-3 rounded-2xl"><Sparkles size={28} className="text-blue-500" /></div>
                <h2 className="text-3xl font-black uppercase italic tracking-tighter text-white">Road Intel</h2>
             </div>
             {isBriefingLoading ? (
               <div className="flex flex-col items-center py-20 gap-6 grow justify-center">
                  <Loader2 size={48} className="text-blue-500 animate-spin" />
                  <p className="text-zinc-500 font-black uppercase tracking-[0.2em] text-[10px] animate-pulse">Scanning Cambridgeshire Grids...</p>
               </div>
             ) : (
               <>
                 <div className="flex-1 overflow-y-auto pr-4 no-scrollbar space-y-6">
                   <div className="text-lg font-medium text-zinc-300 leading-relaxed border-l-2 border-blue-500/50 pl-6 italic">
                     {aiBriefing?.text}
                   </div>
                   <div className="flex flex-wrap gap-2 pt-4">
                     {aiBriefing?.sources.map((s, i) => (
                       <a key={i} href={s.uri} target="_blank" className="text-[9px] bg-blue-500/10 text-blue-400 px-3 py-1.5 rounded-lg border border-blue-500/20 font-bold uppercase tracking-wider hover:bg-blue-500/20 transition-colors">{s.title || 'Official Source'}</a>
                     ))}
                   </div>
                 </div>
                 <button onClick={() => setActiveModal('NONE')} className="mt-8 w-full bg-white text-black py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95">Acknowledge & Sync</button>
               </>
             )}
          </div>
        </div>
      )}

      {activeModal === 'ADMIN_LOGIN' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass rounded-[2.5rem] p-12 w-full max-w-xs text-center border-white/10 shadow-3xl">
            <h2 className="text-xl font-black uppercase tracking-[0.2em] text-zinc-500 mb-8">Access Key</h2>
            <form onSubmit={handleAdminSubmit}>
              <input type="password" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} className="w-full bg-black/50 border-2 border-zinc-800 rounded-3xl py-6 text-center text-4xl font-black mb-8 mono focus:border-blue-500 focus:outline-none transition-colors" autoFocus />
              <button type="submit" className="w-full bg-white text-black py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all">Link System</button>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'SIGN_OUT_CONFIRM' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
          <div className="glass border-red-500/20 rounded-[2.5rem] p-10 w-full max-w-sm shadow-2xl text-center">
             <div className="bg-red-500/10 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-red-500/20 text-red-500">
                <Power size={32} />
             </div>
            <h2 className="text-3xl font-black text-white mb-2 tracking-tighter uppercase italic">End Shift?</h2>
            <p className="text-zinc-500 font-medium mb-10 text-sm">Telemetry will be paused and session archived.</p>
            <div className="flex flex-col gap-4">
              <button onClick={() => { setIsStarted(false); setActiveModal('NONE'); }} className="w-full bg-red-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-red-500/20 active:scale-95 transition-all uppercase tracking-widest italic">Abort Shift</button>
              <button onClick={() => setActiveModal('NONE')} className="w-full bg-zinc-800 text-zinc-400 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all">Maintain Link</button>
            </div>
          </div>
        </div>
      )}

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
    </div>
  );
};

export default App;
