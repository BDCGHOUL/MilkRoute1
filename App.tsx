
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
  Construction, Zap, Loader2, Info, Sparkles, Navigation2
} from 'lucide-react';

type ModalState = 'NONE' | 'ADMIN_LOGIN' | 'SIGN_OUT_CONFIRM' | 'ADD_STOP' | 'BRIEFING';

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
    if (isStarted) localStorage.setItem('log_nav_idx', index.toString());
  }, [index, isStarted]);

  const generateBriefing = async () => {
    setIsBriefingLoading(true);
    setActiveModal('BRIEFING');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentRouteNames = stops.slice(index, index + 20).map(s => s.addr).join(', ');
      
      // Step 1: Search and Strategize
      const searchResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze live road conditions in Cambridge UK for tonight. 
        Focus on these streets: ${currentRouteNames}. 
        Provide a detailed report and a section titled "Best Route Strategy" with tactical advice.`,
        config: { tools: [{ googleSearch: {} }] }
      });

      const fullText = searchResponse.text || "No reports found.";
      const strategyMatch = fullText.match(/Best Route Strategy:(.*)/si);
      const strategyText = strategyMatch ? strategyMatch[1].trim() : "Maintain standard sequence.";
      const reportText = fullText.split("Best Route Strategy:")[0].trim();

      // Step 2: Auto-Marking Closure Extraction
      const closureParser = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Based on this traffic report: "${fullText}", extract any specific blocked street coordinates for these locations: ${JSON.stringify(stops.slice(index, index + 20))}. 
        Return ONLY a JSON array of objects with {lat, lng, note}.`,
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
      try { detectedClosures = JSON.parse(closureParser.text.trim()); } catch (e) {}

      if (detectedClosures.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const newClosures: RoadClosure[] = detectedClosures.map(dc => ({
          id: `ai-${Math.random()}`,
          lat: dc.lat,
          lng: dc.lng,
          radius: 150,
          startDate: today,
          endDate: today,
          note: `INTEL: ${dc.note}`
        }));
        setClosures(prev => [...prev, ...newClosures]);
        localStorage.setItem('log_nav_closures', JSON.stringify([...closures, ...newClosures]));
      }

      setAiBriefing({ 
        text: reportText, 
        strategy: strategyText, 
        sources: (searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
          .map((c: any) => c.web).filter(Boolean)
      });
    } catch (e) {
      setAiBriefing({ text: "Intel server unreachable. Using local cache.", strategy: "Monitor local radio/apps.", sources: [] });
    } finally {
      setIsBriefingLoading(false);
    }
  };

  const handleSignOut = () => {
    setIsStarted(false);
    setIndex(0);
    localStorage.removeItem('log_nav_idx');
    localStorage.removeItem('log_nav_stops_v6');
    setActiveModal('NONE');
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
    setIsClosureMode(false);
    localStorage.removeItem('adminSession');
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

      {/* Dynamic Header */}
      <div className="flex justify-between items-center h-14 shrink-0 px-4 z-[100] glass rounded-2xl border-white/10">
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-blue-500 tracking-[0.4em] uppercase">Logistics Core</span>
          <span className="text-sm font-black mono mt-0.5">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div className="flex gap-1 sm:gap-2">
            {isAdmin && <button onClick={handleAdminLogout} className="p-2.5 text-orange-500 bg-orange-500/10 rounded-xl border border-orange-500/20 active:scale-95"><Lock size={18} /></button>}
            <button onClick={() => setShowCalc(true)} className="p-2.5 text-yellow-500 bg-yellow-500/10 rounded-xl border border-yellow-500/20 active:scale-95"><CalcIcon size={18} /></button>
            <button onClick={() => setActiveModal('BRIEFING')} className="p-2.5 text-blue-500 bg-blue-500/10 rounded-xl border border-blue-500/20 active:scale-95"><Info size={18} /></button>
            <button onClick={() => setActiveModal('SIGN_OUT_CONFIRM')} className="p-2.5 text-red-500 bg-red-500/10 rounded-xl border border-red-500/20 active:scale-95"><Power size={18} /></button>
        </div>
      </div>

      {/* Stats Dashboard */}
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

      {/* Main Map Viewport */}
      <div className="flex-1 relative rounded-3xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-2xl min-h-0">
        <MapView 
          stops={stops} 
          index={index} 
          routeType={routeType} 
          lastPos={logicalPos || lastPos} 
          isAdmin={isAdmin} 
          onStopsUpdate={(s) => { setStops(s as StopWithMeta[]); localStorage.setItem('log_nav_stops_v6', JSON.stringify(s)); }} 
          closures={closures} 
          onMapClick={(lat, lng) => { if(isAdmin && isClosureMode) { setActiveModal('NONE'); /* Future implementation */ } }} 
        />
        
        {/* Admin Floating Controls */}
        {isAdmin && (
          <div className="absolute top-4 right-4 flex flex-col gap-3 z-[1000]">
            <button onClick={() => setIsClosureMode(!isClosureMode)} className={`w-12 h-12 rounded-2xl border-2 flex items-center justify-center shadow-2xl transition-all ${isClosureMode ? 'bg-red-600 border-white scale-110' : 'bg-black/60 backdrop-blur-md border-white/10'}`}>
              <Construction size={20} />
            </button>
            <button onClick={() => setActiveModal('ADD_STOP')} className="w-12 h-12 bg-white text-black rounded-2xl flex items-center justify-center shadow-2xl active:scale-90">
              <Plus size={24} />
            </button>
          </div>
        )}

        {/* Flight Deck - Navigation Actions */}
        <div className="absolute bottom-4 left-4 right-4 flex gap-3 z-[1000]">
           <button 
             onClick={() => { const s = stops[index]; if (s) window.open(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, '_blank'); }} 
             className="flex-1 bg-blue-600 text-white h-16 rounded-2xl font-black text-sm pulse-accent shadow-2xl active:scale-95 uppercase tracking-widest italic flex items-center justify-center gap-2"
           >
             <Navigation2 size={20} fill="currentColor" />
             Launch Navigation
           </button>
           <button 
             onClick={async () => { setIsOptimizing(true); await new Promise(r => setTimeout(r, 800)); setIsOptimizing(false); generateBriefing(); }} 
             className="px-6 bg-black/80 backdrop-blur-md border border-white/10 text-white h-16 rounded-2xl font-black text-[10px] flex items-center gap-2 shadow-xl active:scale-95 uppercase tracking-widest"
           >
             {isOptimizing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={14} className="text-yellow-400" />} 
             AI Reroute
           </button>
        </div>
      </div>

      {/* ROAD INTEL MODAL */}
      {activeModal === 'BRIEFING' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 bg-black/95 backdrop-blur-2xl">
          <div className="glass border-blue-500/20 rounded-[2.5rem] p-8 sm:p-10 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden">
             <div className="flex items-center gap-4 mb-8 shrink-0">
                <div className="bg-blue-600/20 p-3.5 rounded-2xl border border-blue-500/30"><Sparkles size={28} className="text-blue-500" /></div>
                <div>
                  <h2 className="text-3xl font-black uppercase italic tracking-tighter text-white">Road Intel</h2>
                  <p className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">Live Infrastructure Scan</p>
                </div>
             </div>

             {isBriefingLoading ? (
               <div className="flex flex-col items-center py-20 gap-8 grow justify-center">
                  <div className="relative">
                    <Loader2 size={56} className="text-blue-500 animate-spin" />
                    <Zap size={20} className="text-yellow-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-zinc-300 font-black uppercase tracking-[0.2em] text-xs">Analyzing Grid Patterns</p>
                    <p className="text-zinc-600 font-bold text-[9px] uppercase tracking-widest">Checking local authority data...</p>
                  </div>
               </div>
             ) : (
               <>
                 <div className="flex-1 overflow-y-auto pr-3 no-scrollbar space-y-8">
                   <div className="space-y-4">
                      <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Condition Report
                      </div>
                      <div className="text-lg font-medium text-zinc-200 leading-relaxed italic border-l-2 border-zinc-800 pl-5">
                        {aiBriefing?.text}
                      </div>
                   </div>

                   <div className="space-y-4">
                      <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2">
                         <Zap size={10} className="fill-blue-500 text-blue-500" /> AI Strategic Analysis
                      </div>
                      <div className="bg-blue-600/5 border border-blue-500/20 rounded-2xl p-6 text-blue-100 font-black text-xl italic tracking-tighter leading-tight shadow-inner">
                         {aiBriefing?.strategy}
                      </div>
                   </div>
                   
                   {aiBriefing?.sources && aiBriefing.sources.length > 0 && (
                     <div className="pt-4 border-t border-white/5">
                       <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-3">Verification Sources</p>
                       <div className="flex flex-wrap gap-2">
                         {aiBriefing.sources.map((s, i) => (
                           <a key={i} href={s.uri} target="_blank" className="text-[9px] bg-white/5 text-zinc-500 px-3 py-1.5 rounded-lg border border-white/5 hover:text-blue-400 transition-colors uppercase font-bold truncate max-w-[150px]">{s.title || 'Gov Source'}</a>
                         ))}
                       </div>
                     </div>
                   )}
                 </div>

                 <div className="mt-8 pt-6 border-t border-white/5 shrink-0">
                   <button onClick={() => setActiveModal('NONE')} className="w-full bg-white text-black py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">Acknowledge Intel</button>
                 </div>
               </>
             )}
          </div>
        </div>
      )}

      {/* END SHIFT CONFIRMATION */}
      {activeModal === 'SIGN_OUT_CONFIRM' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/95 backdrop-blur-lg">
          <div className="glass border-red-500/20 rounded-[2.5rem] p-10 w-full max-w-xs text-center shadow-2xl">
            <div className="bg-red-500/10 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-red-500/20 text-red-500">
              <Power size={32} />
            </div>
            <h2 className="text-3xl font-black text-white mb-2 uppercase italic tracking-tighter">End Shift?</h2>
            <p className="text-zinc-500 font-medium mb-10 text-sm">Session will be fully purged.</p>
            <div className="flex flex-col gap-4">
              <button onClick={handleSignOut} className="w-full bg-red-600 text-white py-5 rounded-2xl font-black text-lg shadow-xl active:scale-95 uppercase italic tracking-tighter">Purge Session</button>
              <button onClick={() => setActiveModal('NONE')} className="w-full bg-white/5 text-zinc-400 py-4 rounded-2xl font-black text-xs uppercase tracking-widest">Return</button>
            </div>
          </div>
        </div>
      )}

      {/* ADMIN LOGIN */}
      {activeModal === 'ADMIN_LOGIN' && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass rounded-[2.5rem] p-10 w-full max-w-xs text-center border-white/10 shadow-3xl">
            <h2 className="text-xl font-black uppercase tracking-[0.2em] text-zinc-500 mb-8">Access Key</h2>
            <form onSubmit={(e) => { e.preventDefault(); if(adminPassInput === "5371") { setIsAdmin(true); localStorage.setItem('adminSession', 'active'); setActiveModal('NONE'); } else { setAdminPassInput(''); } }}>
              <input type="password" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} className="w-full bg-black border-2 border-zinc-800 rounded-3xl py-6 text-center text-4xl font-black mb-8 mono focus:border-blue-500 outline-none transition-all shadow-inner" autoFocus />
              <button type="submit" className="w-full bg-white text-black py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 shadow-xl">Link Core</button>
            </form>
          </div>
        </div>
      )}

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
    </div>
  );
};

export default App;
