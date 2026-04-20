"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import format from "date-fns/format";
import parse from "date-fns/parse";
import startOfWeek from "date-fns/startOfWeek";
import getDay from "date-fns/getDay";
import enUS from "date-fns/locale/en-US";
import { toPng } from "html-to-image";
import "react-big-calendar/lib/css/react-big-calendar.css";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });
const dayMap: Record<string, number> = { "M": 1, "Tu": 2, "W": 3, "Th": 4, "F": 5, "Sa": 6, "Su": 7 };

const COURSE_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#6366f1"];

function getCourseColor(crn: string) {
  let hash = 0;
  for (let i = 0; i < crn.length; i++) hash = (Math.imul(31, hash) + crn.charCodeAt(i)) | 0;
  return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
}

function formatTime12h(time24: string) {
  if (!time24) return "";
  const [hourStr, minStr] = time24.split(":");
  if (!hourStr || !minStr) return time24;
  let h = parseInt(hourStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12; 
  return `${h}:${minStr} ${ampm}`;
}

function generateEventsFromMeetings(course: any) {
  const events: any[] = [];
  if (!course.meetings) return events; 
  
  const seenTimes = new Set();

  course.meetings.forEach((meeting: any) => {
    if (!meeting.startTime || !meeting.endTime || !meeting.days || meeting.days.length === 0) return;
    
    const [startH, startM] = meeting.startTime.split(":").map(Number);
    const [endH, endM] = meeting.endTime.split(":").map(Number);
    
    meeting.days.forEach((day: string) => {
      const dateOffset = dayMap[day];
      if (dateOffset) {
        const timeKey = `${day}-${meeting.startTime}-${meeting.endTime}`;
        
        if (!seenTimes.has(timeKey)) {
          seenTimes.add(timeKey);
          
          events.push({
            title: `${course.subject} ${course.courseNumber}`,
            start: new Date(2024, 0, dateOffset, startH, startM),
            end: new Date(2024, 0, dateOffset, endH, endM),
            courseInfo: course
          });
        }
      }
    });
  });
  return events;
}

function checkConflict(newEvents: any[], existingEvents: any[]) {
  for (const newEv of newEvents) {
    for (const existEv of existingEvents) {
      if (newEv.start.getTime() < existEv.end.getTime() && newEv.end.getTime() > existEv.start.getTime()) {
        return existEv.title; 
      }
    }
  }
  return null;
}

type Schedule = {
  id: string;
  name: string;
  courses: any[];
};

export default function Home() {
  const [searchQuery, setSearchQuery] = useState(""); 
  const [termQuery, setTermQuery] = useState("2026-Fall"); 
  
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "added">("search");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [isLoaded, setIsLoaded] = useState(false); 
  const calendarRef = useRef<HTMLDivElement>(null);

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeScheduleId, setActiveScheduleId] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<any>(null);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // --- NEW: Unsaved Changes State ---
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isFirstRender = useRef(true);

  // 1. Initial Load
  useEffect(() => {
    const saved = localStorage.getItem("cypress_multi_schedules");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSchedules(parsed.schedules);
        setActiveScheduleId(parsed.activeId);
      } catch (e) {
        console.error("Failed to parse saved schedules");
      }
    } else {
      const defaultId = Date.now().toString();
      setSchedules([{ id: defaultId, name: "Fall 2026 Plan", courses: [] }]);
      setActiveScheduleId(defaultId);
    }
    setIsLoaded(true);
    setHasUnsavedChanges(false); // Ensure we start clean
  }, []);

  // 2. Track Changes (Replaces the old auto-save)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // If schedules or active ID changes after the first load, mark as unsaved!
    if (isLoaded) {
      setHasUnsavedChanges(true);
    }
  }, [schedules, activeScheduleId, isLoaded]);

  // 3. Browser Close Warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ""; // This triggers the browser's native popup
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // 4. Manual Save Function
  const handleSaveSchedule = () => {
    localStorage.setItem("cypress_multi_schedules", JSON.stringify({
      schedules: schedules,
      activeId: activeScheduleId
    }));
    setHasUnsavedChanges(false); // Clear the warning!
  };

  const activeSchedule = schedules.find(s => s.id === activeScheduleId) || schedules[0];
  const activeCourses = activeSchedule?.courses || [];
  
  const myScheduleEvents = useMemo(() => {
    let events: any[] = [];
    activeCourses.forEach(c => events.push(...generateEventsFromMeetings(c)));
    return events;
  }, [activeCourses]);

  const groupedSearchResults = useMemo(() => {
    const groups = new Map<string, any>();
    
    searchResults.forEach(course => {
      const key = `${course.subject} ${course.courseNumber}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          subject: course.subject,
          courseNumber: course.courseNumber,
          title: course.title,
          sections: []
        });
      }
      groups.get(key).sections.push(course);
    });
    
    return Array.from(groups.values());
  }, [searchResults]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const handleCreateNewSchedule = () => {
    const newId = Date.now().toString();
    const newName = `New Schedule ${schedules.length + 1}`;
    setSchedules([...schedules, { id: newId, name: newName, courses: [] }]);
    setActiveScheduleId(newId);
    setIsDropdownOpen(false);
  };

  const handleRenameSchedule = (id: string, currentName: string) => {
    const newName = window.prompt("Enter a new name for this schedule:", currentName);
    if (!newName || newName.trim() === "") return;
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
  };

  const handleDeleteSchedule = (id: string) => {
    if (schedules.length === 1) {
      alert("You cannot delete your only schedule! Clear its classes instead.");
      return;
    }
    if (window.confirm("Are you sure you want to delete this schedule forever?")) {
      const updatedSchedules = schedules.filter(s => s.id !== id);
      setSchedules(updatedSchedules);
      if (activeScheduleId === id) {
        setActiveScheduleId(updatedSchedules[0].id); 
      }
    }
  };

  const addCourseToSchedule = (course: any) => {
    const newEvents = generateEventsFromMeetings(course);
    const conflict = checkConflict(newEvents, myScheduleEvents);
    if (conflict) {
      const proceed = window.confirm(`⚠️ Time Conflict! Overlaps with ${conflict}.\n\nAdd anyway?`);
      if (!proceed) return;
    }
    if (newEvents.length === 0) alert(`⚠️ ${course.subject} ${course.courseNumber} is Online/TBA. No times to show on calendar, but it has been added to your list!`);
    
    const existingTerms = Array.from(new Set(activeCourses.map(c => c.term)));
    if (existingTerms.some(term => term !== course.term)) {
      setToastMessage(`Warning: You just added a ${course.term} class, but your schedule contains classes from other terms.`);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setToastMessage(null);
      }, 5000);
    }

    setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, courses: [...s.courses, course] } : s));
  };

  const removeCourseFromSchedule = (course: any) => {
    setSchedules(prev => prev.map(s => s.id === activeScheduleId 
      ? { ...s, courses: s.courses.filter(c => c.crn !== course.crn) } 
      : s
    ));
    setSelectedEvent(null);
  };

  const clearActiveSchedule = () => {
    if (window.confirm(`Clear all classes from "${activeSchedule?.name}"?`)) {
      setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, courses: [] } : s));
    }
  };

  const performSearch = useCallback(async (query: string, term: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    
    setIsSearching(true);
    try {
      const res = await fetch(`/api/courses?q=${encodeURIComponent(query)}&term=${term}`);
      const data = await res.json();
      setSearchResults(data);
      
      if (data.length > 0) {
        const firstKey = `${data[0].subject} ${data[0].courseNumber}`;
        setExpandedGroups({ [firstKey]: true });
      } else {
        setExpandedGroups({});
      }
    } catch (err) {
      console.error("Search failed", err);
    }
    setIsSearching(false);
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      performSearch(searchQuery, termQuery);
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, termQuery, performSearch]);

  const exportCalendarAsImage = async () => {
    if (!calendarRef.current) return;
    try {
      const dataUrl = await toPng(calendarRef.current, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${activeSchedule?.name.replace(/\s+/g, '-')}-schedule.png`; 
      link.click();
    } catch (error) {
      alert("Oops! Something went wrong while saving the image.");
    }
  };

  const exportCalendarAsIcs = () => {
    if (myScheduleEvents.length === 0) return;

    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Cypress Scheduler//EN\n";

    const formatIcsDate = (date: Date) => {
      const pad = (n: number) => n < 10 ? '0' + n : n;
      return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    };

    myScheduleEvents.forEach((event, i) => {
      const startDate = formatIcsDate(event.start);
      const endDate = formatIcsDate(event.end);
      const profs = event.courseInfo.professors?.join(', ') || 'TBA';

      icsContent += "BEGIN:VEVENT\n";
      icsContent += `UID:event-${i}-${Date.now()}@cypress-scheduler\n`;
      icsContent += `DTSTAMP:${formatIcsDate(new Date())}Z\n`;
      icsContent += `DTSTART:${startDate}\n`;
      icsContent += `DTEND:${endDate}\n`;
      icsContent += `SUMMARY:${event.title}\n`;
      icsContent += `DESCRIPTION:${event.courseInfo.title}\\nCRN: ${event.courseInfo.crn}\\nInstructor: ${profs}\n`;
      icsContent += `RRULE:FREQ=WEEKLY;COUNT=16\n`;
      icsContent += "END:VEVENT\n";
    });

    icsContent += "END:VCALENDAR";

    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeSchedule?.name.replace(/\s+/g, '-')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalUnits = activeCourses.reduce((sum, course) => sum + (course.units || 0), 0);

  if (!isLoaded) return null; 

  const CourseCard = ({ course, isAdded }: { course: any, isAdded: boolean }) => {
    const courseColor = getCourseColor(course.crn);
    let allTags = course.meetings?.map((m: any) => {
      if (m.days && m.days.length > 0) {
        const start = formatTime12h(m.startTime);
        const end = formatTime12h(m.endTime);
        return end ? `${m.days.join("")} ${start} - ${end}` : `${m.days.join("")} ${start}`;
      }
      return "ONLINE";
    }) || [];
    
    if (allTags.length === 0) allTags = ["ONLINE"];
    const uniqueTags = Array.from(new Set(allTags));

    return (
      <div 
        className={`p-4 border rounded-xl shadow-sm transition-all ${isAdded ? 'bg-white' : 'border-gray-200 bg-white hover:border-blue-300'}`}
        style={isAdded ? { borderLeft: `6px solid ${courseColor}` } : {}}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h2 className="font-extrabold text-blue-900">{course.subject} {course.courseNumber}</h2>
            <p className="text-xs font-medium text-gray-700 mb-2">{course.title || "Title TBA"}</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {uniqueTags.map((tag: string, i: number) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold ${tag === 'ONLINE' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                  {tag}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 font-mono">
              CRN: {course.crn} • {course.seatsAvailable} Seats Available
            </p>
          </div>
          {isAdded ? (
            <button onClick={() => removeCourseFromSchedule(course)} className="ml-4 bg-red-100 text-red-700 border border-red-300 text-xs font-bold py-2 px-3 rounded-lg">REMOVE</button>
          ) : (
            <button onClick={() => addCourseToSchedule(course)} className="ml-4 bg-blue-600 text-white text-xs font-bold py-2 px-4 rounded-lg">ADD</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans relative">
      
      {/* SIDEBAR */}
      <div className="w-1/3 p-0 flex flex-col bg-white border-r shadow-xl z-20">
        <div className="p-6 pb-0 border-b border-gray-200 relative">
          <h1 className="text-3xl font-black text-blue-900 tracking-tight mb-4">Cypress Scheduler</h1>
          
          <div className="relative mb-6">
            <button 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full flex items-center justify-between bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-3 px-4 rounded-xl border border-gray-300 transition-colors"
            >
              <span className="truncate pr-4">{activeSchedule?.name || "Loading..."}</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50">
                <div className="max-h-60 overflow-y-auto">
                  {schedules.map(schedule => (
                    <div 
                      key={schedule.id} 
                      className={`flex items-center justify-between p-3 border-b border-gray-100 hover:bg-blue-50 cursor-pointer ${activeScheduleId === schedule.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'border-l-4 border-l-transparent'}`}
                      onClick={() => { setActiveScheduleId(schedule.id); setIsDropdownOpen(false); }}
                    >
                      <span className="font-bold text-gray-800 text-sm flex-1 truncate pr-2">{schedule.name}</span>
                      
                      <div className="flex gap-2 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); handleRenameSchedule(schedule.id, schedule.name); }} className="text-gray-400 hover:text-blue-600 p-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(schedule.id); }} className="text-gray-400 hover:text-red-600 p-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button 
                  onClick={handleCreateNewSchedule}
                  className="w-full p-4 text-sm font-bold text-blue-600 hover:bg-gray-50 flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
                  Add New Schedule
                </button>
              </div>
            )}
          </div>
          
          <div className="flex space-x-4 mb-[-1px]">
            <button 
              onClick={() => setActiveTab("search")}
              className={`pb-3 text-sm font-bold border-b-2 px-2 transition-colors ${activeTab === "search" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            >
              Search
            </button>
            <button 
              onClick={() => setActiveTab("added")}
              className={`pb-3 text-sm font-bold border-b-2 px-2 transition-colors ${activeTab === "added" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
            >
              Added ({activeCourses.length}) - {totalUnits} Units
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          
          {/* SEARCH TAB */}
          {activeTab === "search" && (
            <div>
              <div className="mb-6 flex flex-col gap-3">
                <div className="flex gap-2">
                  <select 
                    value={termQuery}
                    onChange={(e) => setTermQuery(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="2026-Fall">Fall 2026</option>
                    <option value="2026-Summer">Summer 2026</option>
                    <option value="2026-Spring">Winter/Spring 2026</option>
                  </select>

                  <input 
                    type="text" 
                    placeholder="Search by Title, Subject, or CRN..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-4">
                {isSearching && <p className="text-blue-500 text-sm font-bold text-center mt-6 animate-pulse">Searching...</p>}
                
                {groupedSearchResults.length === 0 && !isSearching && searchQuery.length > 0 && (
                  <p className="text-gray-500 text-sm text-center mt-10">No classes found for "{searchQuery}".</p>
                )}

                {groupedSearchResults.length === 0 && !isSearching && searchQuery.length === 0 && (
                  <p className="text-gray-400 text-sm text-center mt-10">Start typing to search for classes.</p>
                )}
                
                {groupedSearchResults.map((group) => {
                  const isExpanded = expandedGroups[group.id];
                  
                  return (
                    <div key={group.id} className="border border-gray-200 rounded-xl shadow-sm bg-white overflow-hidden transition-all">
                      <div 
                        className="p-4 cursor-pointer hover:bg-gray-50 flex justify-between items-center"
                        onClick={() => toggleGroup(group.id)}
                      >
                        <div>
                          <h2 className="font-extrabold text-blue-900 text-lg">{group.subject} {group.courseNumber}</h2>
                          <p className="text-xs font-medium text-gray-700">{group.title}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100">
                            {group.sections.length} Sections
                          </span>
                          <svg 
                            xmlns="http://www.w3.org/2000/svg" 
                            className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
                            viewBox="0 0 20 20" 
                            fill="currentColor"
                          >
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="bg-gray-50 p-3 space-y-2 border-t border-gray-200">
                          {group.sections.map((section: any) => {
                            const isAdded = activeCourses.some((c) => c.crn === section.crn);
                            
                            let allTags = section.meetings?.map((m: any) => {
                              if (m.days && m.days.length > 0) {
                                const start = formatTime12h(m.startTime);
                                const end = formatTime12h(m.endTime);
                                return end ? `${m.days.join("")} ${start} - ${end}` : `${m.days.join("")} ${start}`;
                              }
                              return "ONLINE";
                            }) || [];
                            
                            if (allTags.length === 0) allTags = ["ONLINE"];
                            const uniqueTags = Array.from(new Set(allTags));

                            return (
                              <div key={section.crn} className="flex justify-between items-center bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                                <div>
                                  <div className="flex flex-wrap gap-1 mb-1.5">
                                    {uniqueTags.map((tag: string, i: number) => (
                                      <span key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold ${tag === 'ONLINE' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                                        {tag}
                                      </span>
                                    ))}
                                    {section.professors?.[0] && (
                                      <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-purple-100 text-purple-800">
                                        {section.professors[0]}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-gray-500 font-mono font-medium">
                                    CRN: {section.crn} • {section.seatsAvailable} Seats Open
                                  </p>
                                </div>
                                {isAdded ? (
                                  <button onClick={() => removeCourseFromSchedule(section)} className="ml-3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs font-bold py-1.5 px-3 rounded-md transition-colors">
                                    REMOVE
                                  </button>
                                ) : (
                                  <button onClick={() => addCourseToSchedule(section)} className="ml-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 px-4 rounded-md transition-colors shadow-sm">
                                    ADD
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ADDED CLASSES TAB */}
          {activeTab === "added" && (
            <div className="space-y-4">
              {activeCourses.length > 0 && (
                 <div className="flex justify-end mb-2">
                    <button onClick={clearActiveSchedule} className="text-xs font-bold text-red-500 hover:text-red-700 underline">
                      Clear This Schedule
                    </button>
                 </div>
              )}
              {activeCourses.length === 0 ? (
                <p className="text-gray-400 text-sm text-center mt-10">This schedule is empty.</p>
              ) : (
                activeCourses.map((course) => <CourseCard key={course.crn} course={course} isAdded={true} />)
              )}
            </div>
          )}
        </div>
      </div>

      {/* CALENDAR AREA */}
      <div className="w-2/3 p-8 flex flex-col z-10">
        
        {/* --- THE FIX: NEW ACTION BAR WITH SAVE BUTTON --- */}
        <div className="flex justify-between items-center mb-4">
          
          {/* Left Side: The Save Button */}
          <div>
            <button 
              onClick={handleSaveSchedule}
              disabled={!hasUnsavedChanges}
              className={`flex items-center gap-2 text-sm font-bold py-2 px-4 rounded-lg shadow-md transition-all active:scale-95 ${
                hasUnsavedChanges 
                  ? "bg-green-600 hover:bg-green-700 text-white animate-pulse" 
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {hasUnsavedChanges ? "Save Changes" : "Saved"}
            </button>
          </div>

          {/* Right Side: Export Buttons */}
          <div className="flex gap-3">
            {myScheduleEvents.length > 0 && (
              <>
                <div className="relative group flex items-center">
                  <button onClick={exportCalendarAsIcs} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2 px-4 rounded-lg shadow-md transition-all active:scale-95">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Export .ics
                  </button>
                  <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 hidden group-hover:block w-max bg-gray-900 text-white text-xs font-bold py-2 px-3 rounded-md shadow-xl z-50">
                    Download for Apple/Google Calendar
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>

                <button onClick={exportCalendarAsImage} className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-bold py-2 px-4 rounded-lg shadow-md transition-all active:scale-95">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Save as PNG
                </button>
              </>
            )}
          </div>
        </div>

        <div ref={calendarRef} className="flex-1 bg-white rounded-2xl shadow-2xl p-6 border border-gray-200 overflow-hidden relative">
          <h2 className="absolute top-6 left-6 text-2xl font-black text-gray-200 opacity-50 select-none z-0 pointer-events-none">{activeSchedule?.name}</h2>
          
          <Calendar
            localizer={localizer}
            events={myScheduleEvents}
            startAccessor="start"
            endAccessor="end"
            defaultView="work_week"
            views={["work_week", "day"]}
            min={new Date(2024, 0, 1, 7, 0)}
            max={new Date(2024, 0, 1, 22, 0)}
            defaultDate={new Date(2024, 0, 1)}
            toolbar={false}
            className="rounded-lg cursor-pointer relative z-10"
            onSelectEvent={(event) => setSelectedEvent(event)}
            eventPropGetter={(event) => ({
              style: { backgroundColor: getCourseColor(event.courseInfo.crn), borderRadius: "6px", fontSize: "11px", border: "none", fontWeight: "bold" }
            })}
          />
        </div>
      </div>

      {/* DELETE MODAL */}
      {selectedEvent && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-2xl font-black text-gray-900 mb-1">{selectedEvent.title}</h3>
            <p className="text-gray-600 text-sm font-medium mb-6">{selectedEvent.courseInfo.title}</p>
            <div className="flex gap-3">
              <button onClick={() => setSelectedEvent(null)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-3 px-4 rounded-xl">Cancel</button>
              <button onClick={() => removeCourseFromSchedule(selectedEvent.courseInfo)} className="flex-1 bg-red-600 text-white font-bold py-3 px-4 rounded-xl">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* WARNING TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded-lg shadow-2xl z-50 flex items-start gap-3 max-w-sm transition-all duration-300 transform translate-y-0 opacity-100">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="font-bold text-sm">Term Mismatch</p>
            <p className="text-xs mt-1 font-medium">{toastMessage}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-yellow-600 hover:text-yellow-800 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

    </div>
  );
}