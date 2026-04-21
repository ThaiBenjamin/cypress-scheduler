"use client";

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// A dictionary of Cypress College buildings and their approximate GPS coordinates.
const buildingCoords: Record<string, [number, number]> = {
  'BBF':[33.828350865002704, -118.02147325915115], //Baseball Field
  'BK': [33.82782899995476, -118.0256343519516], // Book Store
  'BUS': [33.82764291754249, -118.0261296107725], // Business 
  'CCCPLX': [33.828293535988884, -118.02536342312762],  // Cypress College Complex
  '1VPA': [33.82908674904778, -118.02565754198164],  // Fine Arts
  'FASS': [33.82917971324042, -118.02440299254006], //Fine Arts Swing Space
  'G1': [33.82768633899941, -118.02395356454173], // Gym 1
  'G2': [33.82721511092138, -118.0237862842233], // Gym 2
  'HUM': [33.82967948582821, -118.024962491319], // Humanities
  'H/HUM': [33.829451459956246, -118.0249256405959], // Humanities Lecture Hall
  'L/LRC': [33.82832918616391, -118.02344296146632], // Library/Learning Resource Center
  'M&O': [33.829522087373014, -118.02246364926803], // Maintenance & Operations
  'POOL': [33.82726389489849, -118.02461708360693], // Pool
  'SBF': [33.827470151893166, -118.02117746689576], // Softball Field
  'SLL': [33.82762283109881, -118.02462661611317], // Student Life & Leadership
  'SC': [33.82776747253072, -118.02515590947029], // Student Center
  'SEM': [33.829171069830466, -118.02343240575921], // Science Engineering Math
  'SOCCER': [33.827048368931024, -118.02028619699738], // Soccer Field
  'TA': [33.82859367670119, -118.02637857202797], // Theater Arts
  'TC': [33.82512279191629, -118.02178829093837], // Tennis Courts
  'TE1': [33.82734880071696, -118.02545998266356], // Tech Ed 1
  'TE2': [33.826992294130825, -118.02464459111573], // Tech Ed 2
  'TE3': [33.82670708779164, -118.02519176175967], // Tech Ed 3
  'TRACK': [33.82573114547679, -118.02066786365502], // Track & Field
  'VRC': [33.827857963876035, -118.02452054448868], // Veterans Resource Center
  'NOCE': [33.82634940282063, -118.02434729307518], // NOCE/ESL Classes
  'LOT1': [33.82738481008401, -118.02689536777606], // Parking Lot 1
  'LOT2': [33.826486612497945, -118.02572211276656], // Parking Lot 2
  'LOT3': [33.82616303595734, -118.02538501865827], // Parking Lot 3
  'LOT4': [33.825258006809676, -118.0234983202711], // Parking Lot 4
  'LOT5': [33.82679243692882, -118.02253763919792], // Parking Lot 5
  'LOT6': [33.829613282480025, -118.02095236932291], // Parking Lot 6
  'LOT7': [33.82876971657518, -118.02238359248902], // Parking Lot 7
  'LOT8': [33.8295000526514, -118.02588668153949], // Parking Lot 8
};

// This fixes the gray space issue when you drag the sidebar
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(map.getContainer());
    return () => resizeObserver.disconnect();
  }, [map]);
  return null;
}

// Function to create a custom colored circle marker
const createColoredMarker = (color: string) => {
  return new L.DivIcon({
    className: 'custom-icon',
    html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.4);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10]
  });
};

export default function CourseMap({ activeCourses, getCourseColor }: { activeCourses: any[], getCourseColor: (crn: string) => string }) {
  const mapCenter: [number, number] = [33.827513179286186, -118.02476871801096];

  // 1. Group the markers by building first
  const groupedMarkers: Record<string, any[]> = {};
  
  activeCourses.forEach(course => {
    if (!course.meetings) return;
    
    course.meetings.forEach((meeting: any) => {
      const bldg = meeting.building;
      if (bldg && buildingCoords[bldg]) {
        if (!groupedMarkers[bldg]) {
          groupedMarkers[bldg] = [];
        }
        groupedMarkers[bldg].push({
          course,
          meeting,
          baseCoords: buildingCoords[bldg],
          color: getCourseColor(course.crn)
        });
      }
    });
  });

  // 2. Spiderfy algorithm: Distribute overlapping markers in a tiny circle
  const finalMarkers: any[] = [];
  const RADIUS = 0.00015; // Roughly a 15-meter offset radius

  Object.values(groupedMarkers).forEach((group: any[]) => {
    const count = group.length;
    
    if (count === 1) {
      // If only one class in the building, put it dead center
      finalMarkers.push({
        ...group[0],
        coords: group[0].baseCoords
      });
    } else {
      // If multiple classes, fan them out in a circle
      group.forEach((marker, index) => {
        const angle = (index / count) * (2 * Math.PI); // Evenly space them out
        
        const latOffset = RADIUS * Math.cos(angle);
        // We multiply the longitude offset slightly to keep the circle looking round on the screen
        const lngOffset = (RADIUS * Math.sin(angle)) * 1.2; 

        finalMarkers.push({
          ...marker,
          coords: [
            marker.baseCoords[0] + latOffset,
            marker.baseCoords[1] + lngOffset
          ]
        });
      });
    }
  });

  return (
    <MapContainer 
      center={mapCenter} 
      zoom={16} 
      style={{ height: '100%', width: '100%', borderRadius: '0.75rem', zIndex: 10 }}
    >
      <MapResizer /> 
      
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      
      {finalMarkers.map((marker, idx) => (
        <Marker 
          key={`${marker.course.crn}-${idx}`} 
          position={marker.coords} 
          icon={createColoredMarker(marker.color)}
        >
          <Popup className="rounded-xl">
            <div className="font-sans">
              <h3 className="font-black text-lg text-gray-900 m-0 leading-tight">
                {marker.course.subject} {marker.course.courseNumber}
              </h3>
              <p className="text-xs font-bold text-gray-500 m-0 mb-2 border-b border-gray-200 pb-2">
                {marker.course.title}
              </p>
              
              <div className="flex justify-between items-center mt-2">
                <span className="font-bold text-blue-600">
                  {marker.meeting.building} {marker.meeting.room}
                </span>
                <span className="bg-gray-100 px-2 py-0.5 rounded text-xs font-mono font-bold text-gray-600">
                  {marker.course.crn}
                </span>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}