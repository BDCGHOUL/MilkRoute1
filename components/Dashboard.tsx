
import React, { useState, useEffect, useCallback } from 'react';
import { Stop, RoadClosure } from '../types';
import { ETA_MULTIPLIER, SERVICE_TIME_PER_STOP } from '../constants';
import { AlertTriangle, MapPin, Clock, ArrowRight } from 'lucide-react';

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

  const checkCollision = useCallback((coords: [number, number][], activeClosures: RoadClosure[]) => {
    if (!activeClosures.length || !coords.length) return false;
    const today = new Date().toISOString().split('T')[0];
    for (const c of activeClosures) {
      if (today >= c.startDate && today <= c.endDate) {
        for (const p of coords) {
          const dLat = Math.abs(p[1] - c.lat);
          const dLng = Math.abs(p[0] - c.lng);
          if (dLat < 0.001 && dLng < 0.001) return true;
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
        if (!res.ok) throw new Error("OSRM Limit");
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
          const nextArrival = new Date(now + (nextDrive + SERVICE_TIME_PER_STOP) * 1000);
          setEtaNext(nextArrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }
      } catch (err) {
        const now = Date.now();
        const remaining = stops.slice(index);
        let totalDirectDist = 0;
        let prev = { lat: lastPos[0], lng: lastPos[1] };
        remaining.forEach(s => {
          totalDirectDist += getHaversineDist(prev.lat, prev.lng, s.lat, s.lng);
          prev = s;
        });
        const avgSpeed = 7; 
        const driveTime = (totalDirectDist / avgSpeed) * ETA_MULTIPLIER;
        const serviceTime = remaining.length * SERVICE_TIME_PER_STOP;
        const totalFinish = new Date(now + (driveTime + serviceTime) * 1000);
        setEtaFinish(totalFinish.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        setEtaNext("--:--");
      }
    };

    const timer = setInterval(fetchETAs, 20000);
    fetchETAs();
    return () => clearInterval(timer);
  }, [index, stops, lastPos]);

  const currentStop = stops[index];
  const queue = stops.slice(index + 1, index + 4);
  const dropsLeft = Math.max(0, stops.length - index);

  return (
    <div className={`glass rounded-[2rem] p-5 flex-shrink-0 relative border-2 transition-all duration-500 flex flex-col gap-4 ${isArrived ? 'border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.15)]' : (isPathImpacted ? 'border-red-600 shadow-[0_0_40px_rgba(239,68,68,0.2)]' : 'border-white/5')}`}>
      
      {/* Top Section: Metrics */}
      <div className="flex justify-between items-center">
        <div className="flex gap-4">
           <div className="flex flex-col">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Queue</span>
              <span className="text-4xl font-black text-white mono leading-none">{dropsLeft}</span>
           </div>
           <div className="w-[1px] h-10 bg-white/5" />
           <div className="flex flex-col">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">ETA Fin</span>
              <span className="text-2xl font-black text-red-500 mono leading-none mt-1">{etaFinish}</span>
           </div>
        </div>
        
        <div className="text-right flex flex-col items-end">
           <div className="flex items-center gap-2 bg-yellow-400/10 border border-yellow-400/20 px-3 py-1.5 rounded-full mb-1">
              <Clock size={14} className="text-yellow-400" />
              <span className="text-xs font-black text-yellow-400 mono">{etaNext}</span>
           </div>
           <span className="text-[9px] font-black text-zinc-600 uppercase tracking-tighter">Next Arrival Window</span>
        </div>
      </div>

      {/* Main Action Area: Next Stop */}
      <div className={`p-5 rounded-2xl border transition-all duration-300 relative overflow-hidden flex flex-col gap-1 ${isPathImpacted ? 'bg-red-950/20 border-red-500/30' : 'bg-black/40 border-white/5'}`}>
        <div className="flex items-center justify-between mb-2">
           <div className="flex items-center gap-2">
              {isPathImpacted ? (
                <AlertTriangle size={16} className="text-red-500 animate-bounce" />
              ) : (
                <MapPin size={16} className="text-blue-500" />
              )}
              <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${isPathImpacted ? 'text-red-500' : 'text-zinc-500'}`}>
                {isPathImpacted ? 'Route Blocked' : 'Current Destination'}
              </span>
           </div>
           <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mono">Stop #{index + 1}</span>
        </div>
        
        <h2 className={`text-2xl font-black truncate tracking-tight ${isPathImpacted ? 'text-white' : 'text-blue-100'}`}>
          {currentStop ? currentStop.addr : 'E.O.S (END OF SHIFT)'}
        </h2>

        {/* Upcoming List (Mini) */}
        {queue.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-3 overflow-x-auto no-scrollbar">
             <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest shrink-0">NEXT UP</span>
             {queue.map((s, idx) => (
               <div key={idx} className="flex items-center gap-2 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                  <span className="text-[10px] font-bold text-zinc-500 truncate max-w-[80px]">{s.addr}</span>
                  {idx < queue.length - 1 && <ArrowRight size={10} className="text-zinc-800" />}
               </div>
             ))}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="flex gap-4 h-16">
        <button 
          onClick={onBack}
          className="flex-1 glass border-white/5 hover:bg-white/5 font-black text-sm rounded-2xl active:scale-95 transition-all text-zinc-400 uppercase tracking-widest"
        >
          BACK
        </button>
        <button 
          onClick={onSkip}
          className={`flex-[2] font-black text-xl rounded-2xl active:scale-95 transition-all shadow-xl shadow-blue-500/10 border-b-4 uppercase tracking-tighter ${isArrived ? 'bg-green-600 border-green-800 text-white' : 'bg-blue-600 border-blue-800 text-white'}`}
        >
          {isArrived ? 'PROCEED STOP' : 'SKIP WAYPOINT'}
        </button>
      </div>

      {/* Arrival Progress Bar */}
      <div className="absolute bottom-0 left-0 w-full h-1.5 bg-zinc-900 overflow-hidden rounded-b-[2rem]">
        <div 
          className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-100 ease-linear shadow-[0_0_10px_rgba(34,197,94,0.5)]"
          style={{ width: `${arrivalProgress}%` }}
        />
      </div>
    </div>
  );
};

export default Dashboard;
