
import React, { useEffect, useRef } from 'react';
import { Stop, RouteType, RoadClosure } from '../types';
import L from 'leaflet';

interface MapViewProps {
  stops: Stop[];
  index: number;
  routeType: RouteType;
  lastPos: [number, number] | null;
  isAdmin: boolean;
  onStopsUpdate: (stops: any[]) => void;
  closures: RoadClosure[];
  onMapClick?: (lat: number, lng: number) => void;
}

const MapView: React.FC<MapViewProps> = ({ 
  stops, index, routeType, lastPos, isAdmin, onStopsUpdate, closures, onMapClick 
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const closuresRef = useRef<L.LayerGroup | null>(null);
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapRef.current = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: true
    }).setView([52.23886, 0.18287], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(mapRef.current);
    markersRef.current = L.layerGroup().addTo(mapRef.current);
    closuresRef.current = L.layerGroup().addTo(mapRef.current);
    routeLineRef.current = L.polyline([], { color: '#3b82f6', weight: 4, opacity: 0.6, dashArray: '8, 8' }).addTo(mapRef.current);
    
    userMarkerRef.current = L.circleMarker([0, 0], {
      radius: 8, fillColor: '#ffffff', color: '#3b82f6', weight: 3, fillOpacity: 1
    }).addTo(mapRef.current);

    mapRef.current.on('click', (e) => {
      if (onMapClickRef.current) onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    const observer = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.invalidateSize();
    });
    observer.observe(mapContainerRef.current);

    return () => {
      observer.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markersRef.current || !closuresRef.current) return;
    
    markersRef.current.clearLayers();
    stops.forEach((stop, i) => {
      const isCurrent = i === index;
      const isPast = i < index;
      const markerColor = isCurrent ? '#ef4444' : (isPast ? '#18181b' : '#3b82f6');
      const markerSize = isCurrent ? 36 : 24;
      
      const markerHtml = `
        <div class="relative flex items-center justify-center">
          ${isCurrent ? '<div class="absolute w-12 h-12 bg-red-600/30 rounded-full animate-ping"></div>' : ''}
          <div class="rounded-full border-2 border-white flex items-center justify-center shadow-2xl transition-all duration-300" 
               style="background-color: ${markerColor}; width: ${markerSize}px; height: ${markerSize}px;">
             <span class="text-[10px] font-black text-white italic">${i + 1}</span>
          </div>
        </div>
      `;

      const marker = isAdmin ? 
        L.marker([stop.lat, stop.lng], { 
          draggable: true,
          icon: L.divIcon({ html: markerHtml, className: 'call-icon', iconSize: [40, 40], iconAnchor: [20, 20] }) 
        }).on('dragend', (e: any) => {
          const newStops = [...stops];
          newStops[i] = { ...newStops[i], lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng };
          onStopsUpdate(newStops);
        }) : 
        L.marker([stop.lat, stop.lng], {
          icon: L.divIcon({ html: markerHtml, className: 'call-icon', iconSize: [40, 40], iconAnchor: [20, 20] })
        });
      
      marker.bindTooltip(`<div class="bg-black border border-white/20 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase text-white italic">${stop.addr}</div>`, { permanent: isCurrent, direction: 'top', offset: [0, -10] }).addTo(markersRef.current!);
    });

    closuresRef.current.clearLayers();
    const today = new Date().toISOString().split('T')[0];
    closures.forEach(c => {
      if (today >= c.startDate && today <= c.endDate) {
        L.circle([c.lat, c.lng], { radius: 100, color: '#ef4444', fillOpacity: 0.2, weight: 2, dashArray: '5, 5' }).addTo(closuresRef.current!);
        L.marker([c.lat, c.lng], {
          icon: L.divIcon({
            html: `<div class="bg-red-600 border-2 border-white rounded-xl p-1.5 text-white pulse-accent"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="3" fill="none"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg></div>`,
            iconSize: [32, 32], iconAnchor: [16, 16]
          })
        }).bindPopup(`<div class="bg-zinc-900 border border-red-500 p-2 text-white font-black text-[10px] uppercase">BLOCK: ${c.note}</div>`).addTo(closuresRef.current!);
      }
    });
  }, [stops, index, isAdmin, closures]);

  useEffect(() => {
    if (!mapRef.current || !lastPos || !userMarkerRef.current) return;
    userMarkerRef.current.setLatLng(lastPos);
    const currentStop = stops[index];
    if (currentStop) {
      // AUTO ZOOM LOGIC: Fit map to both user and current waypoint
      const bounds = L.latLngBounds([lastPos, [currentStop.lat, currentStop.lng]]);
      mapRef.current.fitBounds(bounds, { 
        padding: [80, 80], 
        maxZoom: 17,
        animate: true,
        duration: 0.8
      });

      const fetchRoute = async () => {
        try {
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${lastPos[1]},${lastPos[0]};${currentStop.lng},${currentStop.lat}?overview=full&geometries=geojson`);
          const data = await res.json();
          if (data.routes?.[0]?.geometry) {
            const coords = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
            routeLineRef.current?.setLatLngs(coords);
          }
        } catch (e) {
          routeLineRef.current?.setLatLngs([[lastPos[0], lastPos[1]], [currentStop.lat, currentStop.lng]]);
        }
      };
      fetchRoute();
    }
  }, [lastPos, index, stops]);

  return <div ref={mapContainerRef} className="w-full h-full z-0 cursor-crosshair" />;
};

export default MapView;
