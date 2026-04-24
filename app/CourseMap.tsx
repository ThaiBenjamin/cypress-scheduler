"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, ZoomControl, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { BUILDINGS } from '@/lib/scheduler/buildings';
import 'leaflet/dist/leaflet.css';

const DAY_CODES: Record<string, string> = {
  'MON': 'M', 'TUE': 'Tu', 'WED': 'W', 'THU': 'Th', 'FRI': 'F', 'SAT': 'Sa', 'SUN': 'Su'
};

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const snapSize = () => map.invalidateSize({ animate: false });
    snapSize();
    const t1 = setTimeout(snapSize, 50);
    const t2 = setTimeout(snapSize, 200);
    const t3 = setTimeout(snapSize, 500);

    const resizeObserver = new ResizeObserver(() => snapSize());
    resizeObserver.observe(map.getContainer());
    
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      resizeObserver.disconnect();
    };
  }, [map]);
  return null;
}

function MapController({ targetCoords }: { targetCoords: [number, number] | null }) {
  const map = useMap();
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    if (targetCoords) {
      map.flyTo(targetCoords, 18, { duration: 1.5 });
    } else {
      map.flyTo([33.827513179286186, -118.02476871801096], 16, { duration: 1.5 });
    }
  }, [targetCoords, map]);
  return null;
}

/** Small solid dot used when showing a single class meeting at a building. */
const createColoredMarker = (color: string) => {
  return new L.DivIcon({
    className: 'custom-icon',
    html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.4);"></div>`,
    iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10]
  });
};

/** Numbered marker used on day-filtered routes to show class order. */
const createNumberedMarker = (color: string, number: number) => {
  return new L.DivIcon({
    className: 'custom-icon-numbered',
    html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;"><span style="color:white; font-weight:900; font-size:12px; font-family:sans-serif;">${number}</span></div>`,
    iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
  });
};

/** Marker style used when a user searches for a building manually. */
const createRedSearchMarker = () => {
  return new L.DivIcon({
    className: 'search-icon',
    html: `<div style="background-color: #ef4444; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;"><span style="color:white; font-weight:bold; font-size:14px;">!</span></div>`,
    iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
  });
};

export default function CourseMap({ activeCourses, getCourseColor, onColorChange }: { activeCourses: any[], getCourseColor: (crn: string) => string, onColorChange: (crn: string, color: string) => void }) {
  const mapCenter: [number, number] = [33.827513179286186, -118.02476871801096];

  const [isMapReady, setIsMapReady] = useState(false);
  const [activeDay, setActiveDay] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchedBuilding, setSearchedBuilding] = useState<{code: string, coords: [number, number]} | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsMapReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  const availableDays = useMemo(() => {
    let hasSat = false, hasSun = false;
    activeCourses.forEach(course => {
      course.meetings?.forEach((m: any) => {
        if (m.days?.includes('Sa')) hasSat = true;
        if (m.days?.includes('Su')) hasSun = true;
      });
    });
    const days = ["ALL"];
    if (hasSun) days.push("SUN");
    days.push("MON", "TUE", "WED", "THU", "FRI");
    if (hasSat) days.push("SAT");
    return days;
  }, [activeCourses]);

  const mapData = useMemo(() => {
    // Build a raw list of class meetings with building coordinates first.
    let rawList: any[] = [];
    
    activeCourses.forEach(course => {
      if (!course.meetings) return;
      course.meetings.forEach((meeting: any) => {
        const bldg = meeting.building;
        if (activeDay !== "ALL") {
          const targetDayCode = DAY_CODES[activeDay];
          if (!meeting.days || !meeting.days.includes(targetDayCode)) return;
        }
        if (bldg && BUILDINGS[bldg]) {
          const timeVal = parseInt((meeting.startTime || "00:00").replace(':', ''), 10);
          rawList.push({
            course, meeting, buildingCode: bldg, baseCoords: BUILDINGS[bldg].coords,
            color: getCourseColor(course.crn), timeVal: timeVal
          });
        }
      });
    });

    if (activeDay !== "ALL") {
      rawList.sort((a, b) => a.timeVal - b.timeVal);
      rawList.forEach((item, index) => { item.orderNumber = index + 1; });
    }

    // Group multiple classes in the same building so we can fan markers out radially.
    const groupedMarkers: Record<string, any[]> = {};
    rawList.forEach(item => {
      if (!groupedMarkers[item.buildingCode]) groupedMarkers[item.buildingCode] = [];
      groupedMarkers[item.buildingCode].push(item);
    });

    const markers: any[] = [];
    const RADIUS = 0.00015;

    Object.values(groupedMarkers).forEach((group: any[]) => {
      const count = group.length;
      if (count === 1) {
        markers.push({ ...group[0], coords: group[0].baseCoords });
      } else {
        group.sort((a, b) => (a.timeVal || 0) - (b.timeVal || 0));
        group.forEach((marker, index) => {
          const angle = (index / count) * (2 * Math.PI);
          const latOffset = RADIUS * Math.cos(angle);
          const lngOffset = (RADIUS * Math.sin(angle)) * 1.2; 
          markers.push({
            ...marker,
            coords: [marker.baseCoords[0] + latOffset, marker.baseCoords[1] + lngOffset]
          });
        });
      }
    });

    if (activeDay !== "ALL") {
      markers.sort((a, b) => a.orderNumber - b.orderNumber);
    }
    return { markers };
  }, [activeCourses, activeDay, getCourseColor]);

  // Clean, simple dashed lines between classes
  const routeSegments = useMemo(() => {
    const segments: {path: [number, number][], color: string}[] = [];
    
    if (activeDay === "ALL" || mapData.markers.length < 2) return segments;

    for (let i = 0; i < mapData.markers.length - 1; i++) {
      const start = mapData.markers[i].coords;
      const end = mapData.markers[i + 1].coords;
      const color = mapData.markers[i].color;
      
      segments.push({ path: [start, end], color });
    }
    return segments;
  }, [mapData.markers, activeDay]);

  const filteredSearchList = useMemo(() => {
    const isExactMatch = searchedBuilding && searchQuery === `${BUILDINGS[searchedBuilding.code].name} (${searchedBuilding.code})`;
    if (!searchQuery.trim() || isExactMatch) return Object.entries(BUILDINGS);
    
    const query = searchQuery.toLowerCase();
    return Object.entries(BUILDINGS).filter(([code, data]) => 
      code.toLowerCase().includes(query) || 
      data.name.toLowerCase().includes(query)
    );
  }, [searchQuery, searchedBuilding]);

  const handleSearchSelect = (code: string, coords: [number, number]) => {
    setSearchedBuilding({ code, coords });
    setSearchQuery(`${BUILDINGS[code].name} (${code})`);
    setIsDropdownOpen(false);
  };

  return (
    <div className={`relative w-full h-full transition-opacity duration-300 ${isMapReady ? 'opacity-100' : 'opacity-0'}`}>
      
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] w-11/12 max-w-md shadow-lg font-sans flex flex-col pointer-events-auto">
        <div className="bg-white dark:bg-[#2d2d2d] flex items-center justify-between px-1 text-[11px] sm:text-xs font-bold text-gray-500 dark:text-gray-400 rounded-t-xl shadow-sm z-20">
          {availableDays.map((day) => (
            <button
              key={day}
              onClick={() => setActiveDay(day)}
              className={`flex-1 py-2 border-b-2 transition-colors cursor-pointer ${activeDay === day ? 'border-blue-500 text-blue-600 dark:text-white bg-blue-50 dark:bg-[#3d3d3d]' : 'border-transparent hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333]'}`}
            >
              {day}
            </button>
          ))}
        </div>

        <div className={`relative bg-gray-50 dark:bg-[#333333] border-t border-gray-200 dark:border-gray-600 shadow-sm z-10 ${isDropdownOpen && filteredSearchList.length > 0 ? '' : 'rounded-b-xl'}`}>
          <input
            type="text" placeholder="Search for a place" value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setIsDropdownOpen(true); if (e.target.value === '') setSearchedBuilding(null); }}
            onFocus={(e) => { setIsDropdownOpen(true); e.target.select(); }}
            onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
            className="w-full bg-transparent text-gray-900 dark:text-white pl-4 pr-20 py-2 text-sm focus:outline-none placeholder-gray-500 dark:placeholder-gray-400"
          />
          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center text-gray-400">
            {searchQuery && (
              <button onMouseDown={(e) => { e.preventDefault(); setSearchQuery(""); setSearchedBuilding(null); setIsDropdownOpen(false); }} className="p-1.5 hover:text-red-500 transition-colors cursor-pointer" title="Clear selection">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
            <button onMouseDown={(e) => { e.preventDefault(); setIsDropdownOpen(!isDropdownOpen); }} className="p-1.5 hover:text-gray-600 dark:hover:text-gray-200 transition-colors cursor-pointer">
              <svg className={`w-4 h-4 transform transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
          {isDropdownOpen && filteredSearchList.length > 0 && (
            <div className="absolute top-full left-0 w-full bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-gray-600 border-t-0 rounded-b-xl max-h-48 overflow-y-auto shadow-2xl">
              {filteredSearchList.map(([code, data]) => (
                <button key={code} onClick={() => handleSearchSelect(code, data.coords)} className="w-full text-left px-3 py-2 text-xs sm:text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#444] hover:text-blue-600 dark:hover:text-white transition-colors cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <span className="font-bold">{data.name}</span> <span className="text-gray-400 font-mono text-[10px] sm:text-xs ml-1">({code})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <MapContainer center={mapCenter} zoom={16} style={{ height: '100%', width: '100%', zIndex: 10 }} zoomControl={false}>
        <ZoomControl position="bottomright" />
        <MapResizer /> 
        <MapController targetCoords={searchedBuilding ? searchedBuilding.coords : null} />
        
        <TileLayer attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        
        {routeSegments.map((segment, idx) => (
          <Polyline 
            key={`route-${idx}`} 
            positions={segment.path} 
            pathOptions={{ color: segment.color, weight: 4, opacity: 0.9, dashArray: "8, 8", lineCap: "round" }} 
          />
        ))}

        {mapData.markers.map((marker, idx) => {
          const isCustom = marker.course.crn?.startsWith("CUS-");
          const markerIcon = activeDay !== "ALL" && marker.orderNumber 
            ? createNumberedMarker(marker.color, marker.orderNumber) 
            : createColoredMarker(marker.color);
            
          return (
            <Marker key={`${marker.course.crn}-${idx}`} position={marker.coords} icon={markerIcon}>
              <Popup className="rounded-xl custom-popup">
                <div className="font-sans min-w-[200px] p-1">
                  <h3 className="font-black text-lg text-gray-900 m-0 mb-3 leading-tight">
                    {BUILDINGS[marker.buildingCode]?.name || "Unknown Building"} ({marker.buildingCode})
                  </h3>
                  <div className="text-sm text-gray-700 mb-1"><span className="font-bold">Class: </span>{marker.course.subject ? `${marker.course.subject} ` : ''}{marker.course.courseNumber}</div>
                  <div className="text-sm text-gray-700 mb-4"><span className="font-bold">Room: </span>{marker.meeting.building} {marker.meeting.room || ''}</div>
                  
                  {/* NEW MAP POPUP FOOTER */}
                  <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between gap-2">
                    <div className="relative group flex items-center justify-center w-9 h-9 text-gray-400 hover:text-orange-500 transition-colors cursor-pointer bg-gray-50 rounded-md border border-gray-200 shrink-0" title="Change Color">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.813-3.814a1.151 1.151 0 0 0-1.63-1.63l-3.813 3.814a15.995 15.995 0 0 0-4.648 4.764m3.42 3.42a15.996 15.996 0 0 0 4.648-4.764l3.814-3.813a1.151 1.151 0 0 0-1.63-1.63l-3.813 3.814a15.996 15.996 0 0 0-4.764 4.648m3.42 3.42a15.995 15.995 0 0 0 4.648-4.764" /></svg>
                      <input 
                        type="color" 
                        value={getCourseColor(marker.course.crn)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                        onChange={(e) => onColorChange(marker.course.crn, e.target.value)} 
                      />
                    </div>
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${marker.coords[0]},${marker.coords[1]}`} target="_blank" rel="noopener noreferrer" className="flex-1 bg-orange-600 hover:bg-orange-700 text-white !text-white hover:!text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm no-underline h-9">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg> DIRECTIONS
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {searchedBuilding && (
          <Marker position={searchedBuilding.coords} icon={createRedSearchMarker()}>
            <Popup className="rounded-xl custom-popup">
              <div className="font-sans min-w-[200px] p-1 text-center">
                <h3 className="font-black text-lg text-gray-900 m-0 mb-3 leading-tight">{BUILDINGS[searchedBuilding.code].name}</h3>
                <div className="text-sm text-gray-700 mb-4 font-mono font-bold">Code: {searchedBuilding.code}</div>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${searchedBuilding.coords[0]},${searchedBuilding.coords[1]}`} target="_blank" rel="noopener noreferrer" className="w-full bg-orange-600 hover:bg-orange-700 text-white !text-white hover:!text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm no-underline mt-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg> DIRECTIONS
                </a>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
