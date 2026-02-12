
import React, { useState, useEffect, useCallback } from 'react';
import { Stop, RoadClosure } from '../types';
import { ETA_MULTIPLIER, SERVICE_TIME_PER_STOP, TRIGGER_DIST } from '../constants';
import { AlertTriangle, MapPin, Clock, ArrowRight, CheckCircle2 } from 'lucide-react';

interface DashboardProps {
  index: number;
  stops: Stop[];
  lastPos: [number, number] | null;
  isArrived: boolean;
  arrivalProgress: number;
  onSkip: () => void;
  onBack: () => void;
  closures: RoadClosure[];
}

const Dashboard: React.FC<DashboardProps> = ({ 
  index, stops, lastPos, isArrived, arrivalProgress, onSkip, onBack, closures
}) => {
  const [etaFinish, setEtaFinish] = useState('--:--');
  const [etaNext, setEtaNext] = useState('--:--');
  const [isPathImpacted, setIsPathImpacted] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);

  const checkCollision = useCallback((coords: [number, number][], activeClosures: RoadClosure[]) => {
    if (!activeClosures.length || !coords.length) return false;
    const today = new Date().toISOString().split('T')[0];
    for (const c of activeClosures) {
      if (today >= c.startDate && today <= c.endDate) {
        for (const p of coords) {
          const dLat = Math.abs(p[1] - c.lat);
          const dLng = Math.abs(p[0] - c.lng);
          if (dLat < 0.0015 && dLng < 0.0015) return true;
        }
      }
    }
    return false;
  }, []);

  useEffect(() => {
    const isImpacted = checkCollision(routeCoords, closures);
    setIsPathImpacted(isImpacted);
  }, [closures, routeCoords, checkCollision]);

  useEffect(() => {
    if (!lastPos || index >= stops.length) {
      setEtaFinish('--:--');
      setEtaNext('--:--');
      setRouteCoords([]);
      return;
    }

    const fetchETAs = async () => {
      try {
        const remaining = stops.slice(index);
        const coordsStr = `${lastPos[1]},${lastPos[0]};` + remaining.map(s => `${s.lng},${s.lat}`).join(';');
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`);
        const data = await res.json();

        if (data.routes?.[0]) {
          const now = Date.now();
          const route = data.routes[0];
          setRouteCoords(route.geometry.coordinates);

          const driveTime = route.duration * ETA_MULTIPLIER;
          const serviceTime = remaining.length * SERVICE_TIME_PER_STOP;
          const totalFinish = new Date(now + (driveTime + serviceTime) * 1000);
          setEtaFinish(totalFinish.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

          const nextDrive = (route.legs[0]?.duration || 0) * ETA_MULTIPLIER;
          const nextArrival = new Date(now + (nextDrive) * 1000);
          setEtaNext(nextArrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }
      } catch (err) {
        setEtaFinish('CALC...');
      }
    };

    fetchETAs();
    const timer = setInterval(fetchETAs, 30000);
    return () => clearInterval(timer);
  }, [index, stops, lastPos]);

  // Find which stop we are currently "at" to show in the UI if arrived
  const getNearbyStop = () => {
    if (!lastPos) return null;
    const R = 6371e3;
    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const φ1 = lat1 * Math.PI / 180;
      const φ2 = lat2 * Math.PI / 180;
      const Δφ = (lat2 - lat1) * Math.PI / 180;
      const Δλ = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const nearbyIdx = stops.findIndex((s, i) => i >= index && haversine(lastPos[0], lastPos[1], s.lat, s.lng) < TRIGGER_DIST);
    return nearbyIdx !== -1 ? { ...stops[nearbyIdx], actualIndex: nearbyIdx } : null;
  };

  const nearbyStop = getNearbyStop();
  const currentStop = isArrived && nearbyStop ? nearbyStop : stops[index];
  const queue = stops.slice(index + 1, index + 3);
  const dropsLeft = Math.max(0, stops.length - index);

  return (
    <div className={`glass rounded-[2rem] p-4 flex-shrink-0 relative border-2 transition-all duration-500 flex flex-col gap-3 max-h-[35dvh] sm:max-h-none ${isArrived ? 'border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.2)]' : (isPathImpacted ? 'border-red-600 shadow-[0_0_40px_rgba(239,68,68,0.2)]' : 'border-white/5')}`}>
      
      {/* Metrics Row */}
      <div className="flex justify-between items-start">
        <div className="flex gap-4">
           <div className="flex flex-col">
              <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-0.5 italic">Queue</span>
              <span className="text-3xl font-black text-white mono leading-none">{dropsLeft}</span>
           </div>
           <div className="w-[1px] h-8 bg-white/10 self-center" />
           <div className="flex flex-col">
              <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-0.5 italic">Finish</span>
              <span className="text-xl font-black text-red-500 mono leading-none">{etaFinish}</span>
           </div>
        </div>
        
        <div className="flex flex-col items-end">
           <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-full mb-1">
              <Clock size={12} className="text-blue-500" />
              <span className="text-[10px] font-black text-blue-500 mono">{etaNext}</span>
           </div>
           <span className="text-[8px] font-black text-zinc-600 uppercase tracking-tighter italic">ETA Window</span>
        </div>
      </div>

      {/* Destination Card */}
      <div className={`p-4 rounded-2xl border transition-all duration-300 relative overflow-hidden flex flex-col ${isArrived ? 'bg-green-600/10 border-green-500/30' : (isPathImpacted ? 'bg-red-950/20 border-red-500/30' : 'bg-black/40 border-white/5')}`}>
        <div className="flex items-center justify-between mb-1.5">
           <div className="flex items-center gap-2">
              {isArrived ? <CheckCircle2 size={14} className="text-green-500 animate-pulse" /> : (isPathImpacted ? <AlertTriangle size={14} className="text-red-500" /> : <MapPin size={14} className="text-blue-500" />)}
              <span className={`text-[9px] font-black uppercase tracking-[0.2em] italic ${isArrived ? 'text-green-500' : (isPathImpacted ? 'text-red-500' : 'text-zinc-500')}`}>
                {isArrived ? 'Detected at Stop' : (isPathImpacted ? 'Path Impacted' : 'Active Waypoint')}
              </span>
           </div>
           <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mono">Stop #{(nearbyStop?.actualIndex ?? index) + 1}</span>
        </div>
        
        <h2 className={`text-xl sm:text-2xl font-black truncate tracking-tighter italic ${isArrived ? 'text-white' : (isPathImpacted ? 'text-red-100' : 'text-blue-100')}`}>
          {currentStop ? currentStop.addr : 'END OF ROUTE'}
        </h2>

        {/* Mini Queue */}
        {queue.length > 0 && !isArrived && (
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 overflow-hidden">
             <span className="text-[7px] font-black text-zinc-700 uppercase tracking-widest shrink-0 italic">NEXT</span>
             {queue.map((s, idx) => (
               <div key={idx} className="flex items-center gap-2 shrink-0 max-w-[100px]">
                  <span className="text-[9px] font-bold text-zinc-600 truncate italic">{s.addr}</span>
                  {idx < queue.length - 1 && <ArrowRight size={8} className="text-zinc-800" />}
               </div>
             ))}
          </div>
        )}
      </div>

      {/* Control Surface */}
      <div className="flex gap-3 h-14">
        <button 
          onClick={onBack}
          className="flex-1 glass border-white/5 font-black text-[10px] rounded-xl active:scale-95 transition-all text-zinc-500 uppercase tracking-widest italic"
        >
          Back
        </button>
        <button 
          onClick={onSkip}
          className={`flex-[3] font-black text-lg rounded-xl active:scale-95 transition-all shadow-xl border-b-4 uppercase tracking-tighter italic flex items-center justify-center gap-3 ${isArrived ? 'bg-green-600 border-green-800 text-white' : 'bg-blue-600 border-blue-800 text-white'}`}
        >
          {isArrived ? (
            <>
              <CheckCircle2 size={18} />
              <span>Stay to Confirm</span>
            </>
          ) : 'Skip Stop'}
        </button>
      </div>

      {/* Arrival / Auto-Advance Bar */}
      <div className="absolute bottom-0 left-0 w-full h-1.5 bg-zinc-900 overflow-hidden rounded-b-[2rem]">
        <div 
          className={`h-full transition-all duration-100 ease-linear ${isArrived ? 'bg-gradient-to-r from-green-600 to-green-400' : 'bg-blue-600'}`}
          style={{ width: `${isArrived ? arrivalProgress : 0}%` }}
        />
      </div>
    </div>
  );
};

export default Dashboard;
