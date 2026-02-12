
import React, { useState, useEffect, useRef } from 'react';
import { Stop, RouteType, RoadClosure } from './types';
import { TOWN_STOPS, VILLAGE_STOPS, TRIGGER_DIST } from './constants';
import MapView from './components/MapView';
import Dashboard from './components/Dashboard';
import Overlay from './components/Overlay';
import Calculator from './components/Calculator';
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
        contents: `Search https://www.cambridgeshire.gov.uk/residents/travel-roads-and-parking/roads-and-pathways/roadworks-and-faults/roadwork-and-traffic-information and live news for road closures or heavy delays in Cambridge tonight. 
        Focus strictly on the following streets: ${streetNames}. 
        Identify if any of these specific streets are blocked. Provide a professional driver summary and advice on how to handle the route (e.g., skip the street or approach from a different side).`,
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

      const parserResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Based on the following traffic report: "${briefingText}", identify which of these stops are likely blocked. 
        STOPS LIST: ${JSON.stringify(currentRouteStops.map(s => ({ addr: s.addr, lat: s.lat, lng: s.lng })))}
        Return only a JSON array of objects with {lat, lng, note} for each stop that is clearly mentioned as blocked or delayed. If none, return [].`,
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
        console.error("Failed to parse detected closures JSON", e);
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
          note: `AUTO: ${dc.note}`
        }));
        
        setClosures(prev => {
          const filtered = prev.filter(p => !newClosures.some(n => Math.abs(n.lat - p.lat) < 0.0001 && Math.abs(n.lng - p.lng) < 0.0001));
          return [...filtered, ...newClosures];
        });
      }

      setAiBriefing({
        text: briefingText,
        sources: sources
      });
    } catch (e) {
      console.error(e);
      setAiBriefing({
        text: "Briefing system offline. Manual check of Cambridgeshire roadworks portal advised.",
        sources: []
      });
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
      alert("INCORRECT ACCESS CODE");
      setAdminPassInput('');
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (isAdmin && isClosureMode) {
      setTempClosurePos([lat, lng]);
      setActiveModal('ADD_CLOSURE_FORM');
      const today = new Date().toISOString().split('T')[0];
      setClosureDates({ start: today, end: today, note: '' });
      setIsClosureMode(false);
    }
  };

  const saveClosure = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempClosurePos) {
      const newClosure: RoadClosure = {
        id: Math.random().toString(36).substr(2, 9),
        lat: tempClosurePos[0],
        lng: tempClosurePos[1],
        radius: 100,
        startDate: closureDates.start,
        endDate: closureDates.end,
        note: closureDates.note
      };
      setClosures([...closures, newClosure]);
      setActiveModal('NONE');
      setTempClosurePos(null);
    }
  };

  const deleteClosure = (id: string) => {
    setClosures(closures.filter(c => c.id !== id));
  };

  const optimizeRemainingRoute = async () => {
    const activeCurrentClosures = closures.filter(isClosureActive);
    setIsOptimizing(true);
    
    const done = [...stops.slice(0, index)];
    const remaining = [...stops.slice(index)];

    const isBlocked = (s: Stop) => {
      return activeCurrentClosures.some(c => getDist(s.lat, s.lng, c.lat, c.lng) < 200);
    };

    const clearStops = remaining.filter(s => !isBlocked(s)).sort((a, b) => a.originalIndex - b.originalIndex);
    const blockedStops = remaining.filter(s => isBlocked(s)).sort((a, b) => a.originalIndex - b.originalIndex);

    const newRoute = [...done, ...clearStops, ...blockedStops];
    setStops(newRoute);
    
    await new Promise(r => setTimeout(r, 800));
    setIsOptimizing(false);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  };

  const handleSkip = () => {
    const skippedStop = stops[index];
    setLogicalPos([skippedStop.lat, skippedStop.lng]);
    const next = Math.min(stops.length - 1, index + 1);
    setIndex(next);
    localStorage.setItem('log_nav_idx', next.toString());
  };

  const handleBack = () => {
    const prev = Math.max(0, index - 1);
    setIndex(prev);
    if (prev > 0) {
      setLogicalPos([stops[prev-1].lat, stops[prev-1].lng]);
    } else {
      setLogicalPos(lastPos);
    }
    localStorage.setItem('log_nav_idx', prev.toString());
  };

  return (
    <div className="flex flex-col h-full w-full bg-black text-white overflow-hidden p-3 gap-3 relative">
      {!isStarted && (
        <Overlay 
          routeType={routeType} 
          onStart={() => setIsStarted(true)} 
          resumeIndex={index}
          isAdmin={isAdmin}
          onAdminToggle={() => isAdmin ? (setIsAdmin(false), localStorage.removeItem('adminSession')) : setActiveModal('ADMIN_LOGIN')}
          onBriefing={generateBriefing}
        />
      )}

      {/* Header */}
      <div className="flex justify-between items-center h-14 flex-shrink-0 px-3 z-[50] glass rounded-2xl">
        <div className="flex flex-col justify-center">
          <span className="text-[9px] uppercase tracking-[0.4em] text-blue-500 font-black leading-none">LOGISTICS PRO V6</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-black text-white uppercase mono">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <div className="flex items-center gap-1.5 bg-black/40 border border-white/5 px-2 py-0.5 rounded-full text-[8px] font-black text-zinc-400 uppercase tracking-widest">
              <Navigation2 size={8} className={logicalPos ? 'text-blue-500' : 'text-zinc-700'} />
              {logicalPos ? 'LOCK ACTIVE' : 'GPS MODE'}
            </div>
          </div>
        </div>
        
        <div className="flex gap-4 items-center">
            <button 
              onClick={() => setActiveModal('BRIEFING')} 
              className="p-2 text-zinc-500 hover:text-blue-400 transition-colors"
            >
              <Info size={18} />
            </button>
            <button 
              onClick={() => isAdmin ? (setIsAdmin(false), localStorage.removeItem('adminSession')) : setActiveModal('ADMIN_LOGIN')} 
              className={`flex items-center gap-2 p-2 rounded-xl transition-all ${isAdmin ? 'text-green-500 bg-green-500/10 border border-green-500/20' : 'text-zinc-600 hover:text-white'}`}
            >
              <Shield size={20} />
            </button>
            <button 
              onClick={() => setActiveModal('SIGN_OUT_CONFIRM')} 
              className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 active:scale-95 transition-all"
            >
              <Power size={20} />
            </button>
        </div>
      </div>

      <Dashboard 
        index={index} stops={stops} lastPos={logicalPos || lastPos} 
        isArrived={isArrived} arrivalProgress={arrivalProgress} 
        onSkip={handleSkip} onBack={handleBack} closures={closures}
      />

      <div className="flex-1 relative rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-2xl">
        <MapView 
          stops={stops} index={index} routeType={routeType} lastPos={logicalPos || lastPos} 
          isAdmin={isAdmin} onStopsUpdate={(s) => setStops(s as StopWithMeta[])} closures={closures} 
          onMapClick={handleMapClick}
        />
        
        {isClosureMode && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[1001] flex flex-col items-center gap-3">
             <div className="bg-red-600 text-white px-6 py-3 rounded-full font-black text-[10px] uppercase tracking-widest border-2 border-white shadow-2xl animate-pulse">
                Click map to place restriction
             </div>
             <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <div className="absolute top-6 right-6 flex flex-col gap-3 z-[1000] items-end">
           <button 
             onClick={() => { const s = stops[index]; if (s) window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`, '_blank'); }} 
             className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-[0_10px_30px_rgba(59,130,246,0.3)] active:scale-95 transition-all pulse-accent"
           >
             LAUNCH NAVIGATION
           </button>
           
           <button 
             onClick={optimizeRemainingRoute} 
             disabled={isOptimizing} 
             className={`px-8 py-4 rounded-2xl font-black text-sm shadow-xl transition-all flex items-center justify-center gap-2 ${isOptimizing ? 'bg-zinc-800 text-zinc-600' : 'bg-zinc-900 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 active:scale-95'}`}
           >
             {isOptimizing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} className="text-yellow-400" />}
             <span>{isOptimizing ? 'ROUTING...' : 'RE-CALCULATE'}</span>
           </button>
        </div>

        {routeType === RouteType.VILLAGE && (
          <button 
            onClick={() => setShowCalc(true)} 
            className="absolute bottom-6 left-6 z-[1000] bg-yellow-400 text-black p-5 rounded-2xl flex items-center gap-2 font-black shadow-2xl active:scale-95 hover:bg-yellow-300 transition-colors"
          >
            <CalcIcon size={24} />
            CALC
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="fixed bottom-28 right-8 flex flex-col gap-4 z-[2000]">
          <button 
            onClick={() => setIsClosureMode(!isClosureMode)} 
            className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center shadow-2xl active:scale-90 border-2 transition-all ${isClosureMode ? 'bg-red-600 text-white border-white scale-110 shadow-[0_0_30px_rgba(239,68,68,0.4)]' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}
          >
            <Construction size={22} />
          </button>
          <button onClick={() => setActiveModal('CLOSURE_MANAGER')} className="w-14 h-14 bg-zinc-900 text-zinc-400 rounded-2xl flex items-center justify-center shadow-2xl active:scale-90 border-2 border-zinc-800">
            <Calendar size={22} />
          </button>
          <button onClick={() => setActiveModal('ADD_STOP')} className="w-14 h-14 bg-white text-black rounded-2xl flex items-center justify-center shadow-2xl active:scale-90 border-2 border-white">
            <Plus size={32} strokeWidth={3} />
          </button>
        </div>
      )}

      {/* AI Briefing Modal with Scroll Feature */}
      {activeModal === 'BRIEFING' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl">
          <div className="glass border-blue-500/20 rounded-[2.5rem] p-10 w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh]">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
             <div className="flex items-center gap-3 mb-8 shrink-0">
                <div className="bg-blue-500/20 p-3 rounded-2xl">
                  <Sparkles size={28} className="text-blue-500" />
                </div>
                <h2 className="text-3xl font-black text-white tracking-tighter uppercase italic">Road Intel</h2>
             </div>
             
             {isBriefingLoading ? (
               <div className="flex flex-col items-center py-20 gap-6 grow justify-center">
                  <Loader2 size={48} className="text-blue-500 animate-spin" />
                  <p className="text-zinc-500 font-black uppercase tracking-[0.2em] text-xs animate-pulse text-center">Syncing with Cambridgeshire Traffic Control...</p>
               </div>
             ) : (
               <>
                 {/* Scrollable Content Container */}
                 <div className="flex-1 overflow-y-auto pr-4 no-scrollbar space-y-6">
                   <div className="text-lg font-medium text-zinc-300 leading-relaxed border-l-2 border-blue-500/50 pl-6 italic">
                     {aiBriefing?.text}
                   </div>
                   
                   {aiBriefing?.sources && aiBriefing.sources.length > 0 && (
                     <div className="flex flex-wrap gap-2 pt-2 pb-4">
                       {aiBriefing.sources.map((source, i) => (
                         <a 
                           key={i} 
                           href={source.uri} 
                           target="_blank" 
                           rel="noopener noreferrer"
                           className="text-[9px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-1 rounded-md hover:bg-blue-500/20 transition-colors truncate max-w-[150px]"
                         >
                           {source.title || 'Source'}
                         </a>
                       ))}
                     </div>
                   )}
                 </div>

                 {/* Fixed Footer */}
                 <div className="pt-6 border-t border-white/5 flex flex-col gap-4 shrink-0 mt-6">
                    <div className="flex justify-between items-center text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                       <span className="truncate max-w-[200px]">Source: cambridgeshire.gov.uk</span>
                       <span>Sync: {new Date().toLocaleTimeString()}</span>
                    </div>
                    <button 
                      onClick={() => setActiveModal('NONE')} 
                      className="w-full bg-white text-black py-4 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-zinc-200 transition-colors shadow-lg active:scale-95"
                    >
                      Dismiss & Dispatch
                    </button>
                 </div>
               </>
             )}
          </div>
        </div>
      )}

      {activeModal === 'ADMIN_LOGIN' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass border-white/10 rounded-[2.5rem] p-10 w-full max-sm:max-w-xs max-w-sm shadow-2xl">
            <h2 className="text-2xl font-black text-white mb-8 text-center uppercase tracking-tighter">System Access</h2>
            <form onSubmit={handleAdminSubmit}>
              <input type="password" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} placeholder="••••" className="w-full bg-black/50 border-2 border-zinc-800 rounded-3xl py-6 text-center text-5xl font-black text-white mb-8 focus:outline-none focus:border-blue-500 transition-all mono" />
              <button type="submit" className="w-full bg-white text-black py-5 rounded-2xl font-black text-lg active:scale-95 transition-all">ESTABLISH LINK</button>
              <button type="button" onClick={() => setActiveModal('NONE')} className="w-full mt-6 text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em]">Cancel</button>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'CLOSURE_MANAGER' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass border-zinc-800 rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Restriction List</h2>
              <button onClick={() => setActiveModal('NONE')} className="p-2 text-zinc-500"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 no-scrollbar">
              {closures.length === 0 && <div className="text-center py-20 opacity-20"><CheckCircle2 size={64} className="mx-auto mb-4" /><div className="font-black uppercase tracking-widest text-xs">Clear Grid</div></div>}
              {closures.map(c => (
                <div key={c.id} className="bg-black/40 border border-white/5 p-5 rounded-2xl flex justify-between items-center group">
                  <div>
                    <div className="text-white font-black text-xs uppercase mb-1">{c.note || 'REPAIR'}</div>
                    <div className="text-[9px] text-zinc-500 flex items-center gap-1 uppercase font-bold tracking-widest"><Calendar size={10} /> {c.startDate} — {c.endDate}</div>
                  </div>
                  <button onClick={() => deleteClosure(c.id)} className="text-red-500 p-2 bg-red-500/10 rounded-xl opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => {setIsClosureMode(true); setActiveModal('NONE');}} className="mt-6 w-full bg-red-600 text-white py-4 rounded-2xl font-black text-xs tracking-widest uppercase hover:bg-red-500 shadow-xl shadow-red-500/10 italic">Place New Restriction</button>
          </div>
        </div>
      )}

      {activeModal === 'ADD_CLOSURE_FORM' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass border-red-500/20 rounded-[2.5rem] p-10 w-full max-w-sm shadow-2xl">
            <h2 className="text-2xl font-black text-white mb-8 uppercase tracking-tighter italic">Hazard Detail</h2>
            <form onSubmit={saveClosure} className="space-y-4">
              <input type="text" value={closureDates.note} onChange={e => setClosureDates({...closureDates, note: e.target.value})} className="w-full bg-black border border-zinc-800 rounded-xl p-4 text-white font-bold" placeholder="E.g. Burst Water Main" />
              <div className="grid grid-cols-2 gap-4">
                <input type="date" value={closureDates.start} onChange={e => setClosureDates({...closureDates, start: e.target.value})} className="w-full bg-black border border-zinc-800 rounded-xl p-4 text-white font-bold text-xs"/>
                <input type="date" value={closureDates.end} onChange={e => setClosureDates({...closureDates, end: e.target.value})} className="w-full bg-black border border-zinc-800 rounded-xl p-4 text-white font-bold text-xs"/>
              </div>
              <button type="submit" className="w-full bg-red-600 py-4 rounded-2xl font-black text-sm uppercase italic">Activate Constraint</button>
            </form>
          </div>
        </div>
      )}

      {activeModal === 'ADD_STOP' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass border-white/5 rounded-[2.5rem] p-10 w-full max-w-sm shadow-2xl">
            <h2 className="text-2xl font-black text-white mb-8 leading-tight italic uppercase tracking-tighter">Manual Call Entry</h2>
            <form onSubmit={(e) => { e.preventDefault(); if (newStopName && lastPos) { setStops([...stops, { addr: newStopName, lat: lastPos[0], lng: lastPos[1], originalIndex: stops.length }]); setNewStopName(''); setActiveModal('NONE'); } }}>
              <input type="text" value={newStopName} onChange={(e) => setNewStopName(e.target.value)} placeholder="IDENTIFIER / ADDR" className="w-full bg-black border-2 border-zinc-800 rounded-2xl py-6 text-center text-2xl font-black text-white mb-8 uppercase"/>
              <button type="submit" className="w-full bg-green-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest">Inject Call</button>
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
              <button onClick={() => { setIsStarted(false); setActiveModal('NONE'); }} className="w-full bg-red-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-red-500/20 active:scale-95 transition-all">ABORT SHIFT</button>
              <button onClick={() => setActiveModal('NONE')} className="w-full bg-zinc-800 text-zinc-400 py-4 rounded-2xl font-black text-xs uppercase tracking-widest">Maintain Link</button>
            </div>
          </div>
        </div>
      )}

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
    </div>
  );
};

export default App;
