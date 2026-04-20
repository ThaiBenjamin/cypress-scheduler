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

const dayMap: Record<string, number> = { "Su": 1, "M": 2, "Tu": 3, "W": 4, "Th": 5, "F": 6, "Sa": 7 };

const COURSE_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#6366f1"];

function getCourseColor(crn: string) {
  let hash = 0;
  for (let i = 0; i < crn.length; i++) hash = (Math.imul(31, hash) + crn.charCodeAt(i)) | 0;
  return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
}

function formatTimeDisplay(time24: string, is24Hour: boolean) {
  if (!time24) return "";
  const [hourStr, minStr] = time24.split(":");
  if (!hourStr || !minStr) return time24;
  
  if (is24Hour) {
    return `${hourStr.padStart(2, '0')}:${minStr}`;
  }

  let h = parseInt(hourStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12; 
  return `${h}:${minStr} ${ampm}`;
}

function getRmpUrl(profName: string) {
  if (!profName || profName.toUpperCase() === "STAFF") return null;
  const cleanName = profName.replace(" (P)", ""); 
  const parts = cleanName.split(",");
  let query = cleanName;
  if (parts.length === 2) {
    query = `${parts[1].trim()} ${parts[0].trim()}`;
  }
  return `https://www.ratemyprofessors.com/search/professors?q=${encodeURIComponent(query)}`;
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
            start: new Date(2023, 0, dateOffset, startH, startM),
            end: new Date(2023, 0, dateOffset, endH, endM),
            courseInfo: course,
            meetingInfo: meeting
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

type HistoryState = {
  schedules: Schedule[];
  activeId: string;
};

type Theme = "light" | "dark" | "system";

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

  const [past, setPast] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);

  const [isMobileCalendarOpen, setIsMobileCalendarOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>("system");
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  
  const [is24Hour, setIs24Hour] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(33.33); 
  const isDragging = useRef(false);
  const [lastSavedStateString, setLastSavedStateString] = useState<string>("");

  const [isCustomEventModalOpen, setIsCustomEventModalOpen] = useState(false);
  const [customEventName, setCustomEventName] = useState("");
  const [customEventStartTime, setCustomEventStartTime] = useState("10:30");
  const [customEventEndTime, setCustomEventEndTime] = useState("15:30");
  const [customEventDays, setCustomEventDays] = useState<string[]>([]);
  const [customEventScheduleId, setCustomEventScheduleId] = useState<string>("");
  const [editingCustomEventCrn, setEditingCustomEventCrn] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<any>("work_week");

  const startDrag = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none'; 
  }, []);

  const onDrag = useCallback((e: any) => {
    if (!isDragging.current) return;
    let newWidth = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
    if (newWidth < 20) newWidth = 20;
    if (newWidth > 60) newWidth = 60;
    setSidebarWidth(newWidth);
  }, []);

  const stopDrag = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    }
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', stopDrag);
    };
  }, [onDrag, stopDrag]);

  const saveStateToHistory = () => {
    setPast(p => [...p, { 
      schedules: JSON.parse(JSON.stringify(schedules)), 
      activeId: activeScheduleId 
    }]);
    setFuture([]); 
  };

  const undo = () => {
    if (past.length === 0) return;
    const previousState = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    
    setFuture(f => [{ schedules: JSON.parse(JSON.stringify(schedules)), activeId: activeScheduleId }, ...f]);
    setPast(newPast);
    setSchedules(previousState.schedules);
    setActiveScheduleId(previousState.activeId);
  };

  const redo = () => {
    if (future.length === 0) return;
    const nextState = future[0];
    const newFuture = future.slice(1);

    setPast(p => [...p, { schedules: JSON.parse(JSON.stringify(schedules)), activeId: activeScheduleId }]);
    setFuture(newFuture);
    setSchedules(nextState.schedules);
    setActiveScheduleId(nextState.activeId);
  };

  useEffect(() => {
    const savedSchedules = localStorage.getItem("cypress_multi_schedules");
    if (savedSchedules) {
      try {
        const parsed = JSON.parse(savedSchedules);
        setSchedules(parsed.schedules);
        setActiveScheduleId(parsed.activeId);
        setLastSavedStateString(JSON.stringify({ schedules: parsed.schedules, activeId: parsed.activeId }));
      } catch (e) {
        console.error("Failed to parse saved schedules");
      }
    } else {
      const defaultId = Date.now().toString();
      const defaultSchedules = [{ id: defaultId, name: "Fall 2026 Plan", courses: [] }];
      setSchedules(defaultSchedules);
      setActiveScheduleId(defaultId);
      setLastSavedStateString(JSON.stringify({ schedules: defaultSchedules, activeId: defaultId }));
    }

    const savedTheme = localStorage.getItem("cypress_theme") as Theme;
    if (savedTheme) setTheme(savedTheme);

    const savedTimeFormat = localStorage.getItem("cypress_time_format");
    if (savedTimeFormat) setIs24Hour(savedTimeFormat === 'true');
    
    const savedSidebarWidth = localStorage.getItem("cypress_sidebar_width");
    if (savedSidebarWidth) setSidebarWidth(parseFloat(savedSidebarWidth));

    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
    localStorage.setItem("cypress_theme", theme);
  }, [theme, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("cypress_time_format", is24Hour.toString());
  }, [is24Hour, isLoaded]);
  
  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("cypress_sidebar_width", sidebarWidth.toString());
  }, [sidebarWidth, isLoaded]);

  const currentDataString = JSON.stringify({ schedules, activeId: activeScheduleId });
  const hasUnsavedChanges = isLoaded && currentDataString !== lastSavedStateString;

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ""; 
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleSaveSchedule = () => {
    const dataToSave = JSON.stringify({ schedules, activeId: activeScheduleId });
    localStorage.setItem("cypress_multi_schedules", dataToSave);
    setLastSavedStateString(dataToSave);
  };

  const activeSchedule = schedules.find(s => s.id === activeScheduleId) || schedules[0];
  const activeCourses = activeSchedule?.courses || [];
  
  const myScheduleEvents = useMemo(() => {
    let events: any[] = [];
    activeCourses.forEach(c => events.push(...generateEventsFromMeetings(c)));
    return events;
  }, [activeCourses]);

  const showWeekends = useMemo(() => {
    return myScheduleEvents.some(event => {
      const dayOffset = event.start.getDate();
      return dayOffset === 1 || dayOffset === 7; 
    });
  }, [myScheduleEvents]);

  useEffect(() => {
    setCalendarView(showWeekends ? "week" : "work_week");
  }, [showWeekends]);

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
    saveStateToHistory();
    const newId = Date.now().toString();
    const newName = `New Schedule ${schedules.length + 1}`;
    setSchedules([...schedules, { id: newId, name: newName, courses: [] }]);
    setActiveScheduleId(newId);
    setIsDropdownOpen(false);
  };

  const handleRenameSchedule = (id: string, currentName: string) => {
    const newName = window.prompt("Enter a new name for this schedule:", currentName);
    if (!newName || newName.trim() === "") return;
    saveStateToHistory();
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
  };

  const handleDeleteSchedule = (id: string) => {
    if (schedules.length === 1) {
      alert("You cannot delete your only schedule! Clear its classes instead.");
      return;
    }
    if (window.confirm("Are you sure you want to delete this schedule forever?")) {
      saveStateToHistory();
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

    saveStateToHistory();
    setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, courses: [...s.courses, course] } : s));
  };

  const removeCourseFromSchedule = (course: any) => {
    saveStateToHistory();
    setSchedules(prev => prev.map(s => s.id === activeScheduleId 
      ? { ...s, courses: s.courses.filter(c => c.crn !== course.crn) } 
      : s
    ));
    setSelectedEvent(null);
  };

  const clearActiveSchedule = () => {
    if (window.confirm(`Clear all classes from "${activeSchedule?.name}"?`)) {
      saveStateToHistory();
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
      const root = window.document.documentElement;
      const wasDark = root.classList.contains('dark');
      if (wasDark) root.classList.remove('dark');

      const dataUrl = await toPng(calendarRef.current, { pixelRatio: 2, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${activeSchedule?.name.replace(/\s+/g, '-')}-schedule.png`; 
      link.click();

      if (wasDark) root.classList.add('dark');
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

  const calendarFormats = useMemo(() => ({
    timeGutterFormat: is24Hour ? 'HH:mm' : 'h a',
    dayFormat: 'EEE', 
  }), [is24Hour]);

  const totalUnits = activeCourses.reduce((sum, course) => sum + (course.units || 0), 0);

  const CustomEvent = useCallback(({ event }: any) => {
    const startTime = formatTimeDisplay(event.meetingInfo?.startTime, is24Hour);
    const endTime = formatTimeDisplay(event.meetingInfo?.endTime, is24Hour);
    
    let location = "TBA";
    if (event.meetingInfo?.building || event.meetingInfo?.room) {
      const bldg = event.meetingInfo.building || "";
      const room = event.meetingInfo.room || "";
      
      if (bldg.toUpperCase() === "ONLINE") {
        location = "ONLINE";
      } else {
        location = `${bldg} ${room}`.trim();
      }
    } else if (event.meetingInfo?.location) {
      location = event.meetingInfo.location;
    } else if (event.courseInfo?.location) {
      location = event.courseInfo.location;
    }

    const crn = event.courseInfo?.crn;
    const isCustom = crn?.startsWith("CUS-");

    return (
      <div className="flex flex-col w-full h-full overflow-hidden text-[#111827] cursor-pointer">
        <div className="text-[10px] leading-none whitespace-nowrap opacity-90 pointer-events-none font-medium mb-[2px]">
          {startTime} - {endTime}
        </div>
        <div className="font-black text-[12px] leading-none whitespace-nowrap truncate pointer-events-none mb-[2px]">
          {event.title}
        </div>
        
        {!isCustom && (
          <div className="flex justify-between text-[10px] leading-none opacity-90 pointer-events-none">
            <span className="truncate pr-1">{location}</span>
            <span className="shrink-0">{crn}</span>
          </div>
        )}
      </div>
    );
  }, [is24Hour]);

  const handleAddCustomEvent = () => {
    if (!customEventName.trim()) {
      alert("Please enter an event name.");
      return;
    }
    if (customEventDays.length === 0) {
      alert("Please select at least one day.");
      return;
    }

    const targetScheduleId = customEventScheduleId || activeScheduleId;

    const fakeCourse = {
      subject: "",
      courseNumber: customEventName,
      title: "Custom Event",
      crn: editingCustomEventCrn || `CUS-${Date.now()}`,
      term: "Custom",
      units: 0,
      professors: ["Me"],
      meetings: [
        {
          days: customEventDays,
          startTime: customEventStartTime,
          endTime: customEventEndTime,
          type: "Event"
        }
      ]
    };

    saveStateToHistory();
    
    if (editingCustomEventCrn) {
      setSchedules(prev => prev.map(s => s.id === targetScheduleId ? { 
        ...s, 
        courses: s.courses.map(c => c.crn === editingCustomEventCrn ? fakeCourse : c) 
      } : s));
    } else {
      setSchedules(prev => prev.map(s => s.id === targetScheduleId ? { ...s, courses: [...s.courses, fakeCourse] } : s));
    }
    
    setCustomEventName("");
    setCustomEventDays([]);
    setIsCustomEventModalOpen(false);
  };

  const toggleCustomDay = (day: string) => {
    setCustomEventDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  if (!isLoaded) return null; 

  const CourseCard = ({ course, isAdded }: { course: any, isAdded: boolean }) => {
    const courseColor = getCourseColor(course.crn);
    let allTags = course.meetings?.map((m: any) => {
      if (m.days && m.days.length > 0) {
        const start = formatTimeDisplay(m.startTime, is24Hour);
        const end = formatTimeDisplay(m.endTime, is24Hour);
        return end ? `${m.days.join("")} ${start} - ${end}` : `${m.days.join("")} ${start}`;
      }
      return "ONLINE";
    }) || [];
    
    if (allTags.length === 0) allTags = ["ONLINE"];
    const uniqueTags = Array.from(new Set(allTags));

    const profName = course.professors?.[0];
    const rmpUrl = getRmpUrl(profName);

    return (
      <div 
        className={`p-4 border rounded-xl shadow-sm transition-all ${isAdded ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-500 cursor-default'}`}
        style={isAdded ? { borderLeft: `6px solid ${courseColor}` } : {}}
      >
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold text-blue-900 dark:text-blue-400 text-sm sm:text-base break-words">
              {course.subject ? `${course.subject} ${course.courseNumber}` : course.courseNumber}
            </h2>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2 break-words">{course.title || "Title TBA"}</p>
            <div className="flex flex-wrap gap-1 mb-2">
              {uniqueTags.map((tag: string, i: number) => (
                <span key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold ${tag === 'ONLINE' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                  {tag}
                </span>
              ))}
              
              {rmpUrl && course.subject ? (
                <a 
                  href={rmpUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-bold bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200 dark:hover:bg-purple-800 transition-colors cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {profName}
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-75" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                  </svg>
                </a>
              ) : profName && profName.toUpperCase() === "STAFF" ? (
                <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 cursor-default">
                  STAFF
                </span>
              ) : null}

            </div>
            {course.subject && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                CRN: {course.crn} • {(course.maxEnrollment || 0) - (course.seatsAvailable || 0)}/{course.maxEnrollment || 0} Enrolled
              </p>
            )}
          </div>
          <div className="shrink-0 flex items-center justify-end pt-1">
            {isAdded ? (
              <button onClick={() => removeCourseFromSchedule(course)} className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 p-2 rounded-lg cursor-pointer transition-colors hover:bg-red-100 dark:hover:bg-red-900/50 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            ) : (
              <button onClick={() => addCourseToSchedule(course)} className="bg-orange-600 hover:bg-orange-700 text-white p-2 rounded-lg cursor-pointer transition-colors shadow-sm flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-950 font-sans relative overflow-hidden transition-colors duration-300">
      
      <style dangerouslySetInnerHTML={{__html: `
        .rbc-allday-cell { display: none !important; }
        
        .rbc-calendar { color: #111827 !important; font-family: inherit; }
        .rbc-header { color: #111827 !important; font-weight: 800 !important; font-size: 0.875rem; padding: 10px 0 !important; text-transform: uppercase; border-bottom: 2px solid #e5e7eb !important; }
        .rbc-time-view { border: 1px solid #d1d5db !important; border-radius: 8px; overflow: hidden; background: white; }
        .rbc-time-content { border-top: 1px solid #d1d5db !important; }
        .rbc-time-gutter .rbc-timeslot-group { color: #374151 !important; font-weight: 700 !important; font-size: 0.75rem; border-bottom: 1px solid #e5e7eb !important; }
        .rbc-timeslot-group { border-bottom: 1px solid #f3f4f6 !important; min-height: 50px !important; }
        .rbc-day-slot .rbc-time-slot { border-top: 1px dashed #f3f4f6 !important; }
        .rbc-time-content > * + * > * { border-left: 1px solid #e5e7eb !important; }
        .rbc-today { background-color: #f8fafc !important; }
        .watermark-text { color: #f3f4f6 !important; }
        .rbc-event-label { display: none !important; }

        .dark .rbc-calendar { color: #f3f4f6 !important; }
        .dark .rbc-time-view, .dark .rbc-month-view, .dark .rbc-day-bg { border-color: #374151 !important; background: #1f2937 !important; }
        .dark .rbc-time-content { border-color: #374151 !important; }
        .dark .rbc-timeslot-group { border-bottom-color: #374151 !important; }
        .dark .rbc-day-slot .rbc-time-slot { border-top-color: #374151 !important; }
        .dark .rbc-time-content > * + * > * { border-left-color: #374151 !important; }
        .dark .rbc-header { color: #e5e7eb !important; border-bottom-color: #374151 !important; }
        .dark .rbc-time-gutter .rbc-timeslot-group { color: #9ca3af !important; border-bottom-color: #374151 !important; }
        .dark .rbc-today { background-color: #111827 !important; }
        .dark .watermark-text { color: #374151 !important; }
      `}} />

      <nav className="h-16 bg-[#d9531e] text-white flex items-center justify-between px-4 sm:px-6 shadow-md z-30 shrink-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-wide">Cypress Scheduler</h1>
        
        <div className="flex items-center gap-2 sm:gap-4 relative">
          
          <button 
            onClick={handleSaveSchedule}
            disabled={!hasUnsavedChanges}
            className={`flex items-center gap-2 text-sm font-bold py-1.5 px-3 rounded border transition-all cursor-pointer disabled:cursor-not-allowed ${
              hasUnsavedChanges 
                ? "border-white bg-white/20 hover:bg-white/30 text-white shadow-sm" 
                : "border-transparent bg-transparent text-white/50"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span className="hidden sm:inline">SAVE</span>
          </button>

          <div className="relative flex items-center justify-center group">
            <button 
              onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)}
              className="peer p-1.5 hover:bg-white/20 rounded transition-colors cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            {!isSettingsMenuOpen && (
              <div className="absolute top-[120%] right-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                Settings
                <div className="absolute bottom-full right-2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
              </div>
            )}
          </div>

          {isSettingsMenuOpen && (
            <div className="absolute top-full right-0 mt-3 w-64 bg-[#2d2d2d] border border-gray-700 text-white rounded-lg shadow-2xl p-4 z-50">
              
              <h3 className="text-base font-bold mb-2">Theme</h3>
              <div className="flex rounded-md overflow-hidden border border-gray-600 mb-4">
                <button onClick={() => setTheme('light')} className={`flex-1 py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${theme === 'light' ? 'bg-[#d9531e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>
                  ☀️ Light
                </button>
                <button onClick={() => setTheme('system')} className={`flex-1 py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 border-l border-r border-gray-600 cursor-pointer ${theme === 'system' ? 'bg-[#d9531e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>
                  💻 Sys
                </button>
                <button onClick={() => setTheme('dark')} className={`flex-1 py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${theme === 'dark' ? 'bg-[#d9531e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>
                  🌙 Dark
                </button>
              </div>

              <h3 className="text-base font-bold mb-2">Time Format</h3>
              <div className="flex rounded-md overflow-hidden border border-gray-600 mb-2">
                <button 
                  onClick={() => setIs24Hour(false)}
                  className={`flex-1 py-1.5 text-xs font-bold transition-colors cursor-pointer ${!is24Hour ? 'bg-[#d9531e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}
                >
                  12 Hour
                </button>
                <button 
                  onClick={() => setIs24Hour(true)}
                  className={`flex-1 py-1.5 text-xs font-bold border-l border-gray-600 transition-colors cursor-pointer ${is24Hour ? 'bg-[#d9531e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}
                >
                  24 Hour
                </button>
              </div>
            </div>
          )}

        </div>
      </nav>

      <div className="lg:hidden fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
        <button 
          onClick={() => setIsMobileCalendarOpen(!isMobileCalendarOpen)}
          className="bg-gray-900 dark:bg-orange-600 text-white px-6 py-3 rounded-full shadow-2xl font-bold flex items-center gap-2 active:scale-95 transition-transform border border-gray-700 dark:border-orange-500 cursor-pointer"
        >
          {isMobileCalendarOpen ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
              Back to Search
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>
              View Calendar
            </>
          )}
        </button>
      </div>

      <div 
        className="flex flex-1 overflow-hidden relative"
        style={{ '--sidebar-width': `${sidebarWidth}%` } as React.CSSProperties}
      >
        
        {/* CALENDAR AREA */}
        <div className={`w-full lg:w-[calc(100%-var(--sidebar-width))] p-4 lg:p-8 flex-col z-10 transition-colors duration-300 overflow-y-auto ${isMobileCalendarOpen ? 'flex' : 'hidden lg:flex'}`}>
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4 sm:gap-0">
            
            {/* --- NEW: TOP LEFT SCHEDULE SELECTOR --- */}
            <div className="relative group">
              <button 
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="peer flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 text-sm font-bold py-1.5 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                <span className="truncate max-w-[150px]">{activeSchedule?.name || "Loading..."}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {!isDropdownOpen && (
                <div className="absolute top-[110%] left-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max max-w-xs bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                  {activeSchedule?.name || "Loading..."}
                  <div className="absolute bottom-full left-4 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                </div>
              )}

              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-[60]">
                  <div className="max-h-60 overflow-y-auto">
                    {schedules.map(schedule => (
                      <div 
                        key={schedule.id} 
                        className={`flex items-center justify-between p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-orange-50 dark:hover:bg-gray-700 cursor-pointer ${activeScheduleId === schedule.id ? 'bg-orange-50 dark:bg-gray-700 border-l-4 border-l-orange-600' : 'border-l-4 border-l-transparent'}`}
                        onClick={() => { setActiveScheduleId(schedule.id); setIsDropdownOpen(false); }}
                      >
                        <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex-1 truncate pr-2">{schedule.name}</span>
                        
                        <div className="flex gap-2 shrink-0">
                          <button onClick={(e) => { e.stopPropagation(); handleRenameSchedule(schedule.id, schedule.name); }} className="text-gray-400 hover:text-orange-600 p-1 cursor-pointer">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(schedule.id); }} className="text-gray-400 hover:text-red-600 p-1 cursor-pointer">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button 
                    onClick={handleCreateNewSchedule}
                    className="w-full p-4 text-sm font-bold text-orange-600 dark:text-orange-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
                    Add New Schedule
                  </button>
                </div>
              )}
            </div>

            {/* TOP RIGHT ICON TOOLBAR */}
            <div className="flex items-center gap-1 sm:gap-2 text-gray-500 dark:text-gray-400 w-full sm:w-auto">
              
              <div className="relative flex items-center justify-center">
                <button onClick={exportCalendarAsImage} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                  Save as PNG
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <button onClick={exportCalendarAsIcs} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4M12 14v-8m0 8l-4-4m4 4l4-4" />
                  </svg>
                </button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                  Download as .ics file
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <button onClick={undo} disabled={past.length === 0} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                </button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                  Undo
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <button onClick={redo} disabled={future.length === 0} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                  </svg>
                </button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                  Redo
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <button onClick={clearActiveSchedule} className="peer p-2 hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                  Clear Schedule
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                </div>
              </div>

              <div className="relative flex items-center justify-center">
                <button 
                  onClick={() => {
                    setCustomEventName("");
                    setCustomEventStartTime("10:30");
                    setCustomEventEndTime("15:30");
                    setCustomEventDays([]);
                    setCustomEventScheduleId(activeScheduleId);
                    setEditingCustomEventCrn(null);
                    setIsCustomEventModalOpen(true);
                  }}
                  className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <div className="absolute top-[110%] right-0 transform opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                  Add Custom Event
                  <div className="absolute bottom-full right-3 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                </div>
              </div>

            </div>
          </div>

          <div ref={calendarRef} className="flex-1 min-h-[600px] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-4 lg:p-6 border border-gray-200 dark:border-gray-700 overflow-hidden relative mb-20 lg:mb-0">
            <h2 className="watermark-text absolute top-6 left-6 text-xl lg:text-2xl font-black text-gray-200 opacity-50 select-none z-0 pointer-events-none">{activeSchedule?.name}</h2>
            
            <Calendar
              localizer={localizer}
              events={myScheduleEvents}
              startAccessor="start"
              endAccessor="end"
              view={calendarView}
              onView={setCalendarView}
              views={["work_week", "week", "day"]}
              min={new Date(2023, 0, 1, 7, 0)}
              max={new Date(2023, 0, 1, 22, 0)}
              defaultDate={new Date(2023, 0, 1)}
              scrollToTime={new Date(2023, 0, 1, 7, 0)}
              formats={calendarFormats}
              toolbar={false}
              className="rounded-lg relative z-10"
              onSelectEvent={(event) => setSelectedEvent(event)}
              components={{ event: CustomEvent }}
              eventPropGetter={(event) => ({
                style: { 
                  backgroundColor: getCourseColor(event.courseInfo.crn), 
                  borderRadius: "4px", 
                  border: "none", 
                  padding: "1px 4px",
                  cursor: "pointer"
                }
              })}
            />
          </div>
        </div>

        <div
          onMouseDown={startDrag}
          className="hidden lg:flex w-2 cursor-col-resize bg-gray-200 dark:bg-gray-800 hover:bg-orange-400 dark:hover:bg-orange-500 items-center justify-center z-30 flex-shrink-0 group border-l border-r border-gray-300 dark:border-gray-700 hover:border-orange-400 dark:hover:border-orange-500 transition-colors"
        >
          <div className="flex flex-col gap-1.5 opacity-40 group-hover:opacity-100 pointer-events-none">
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-300 group-hover:bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-300 group-hover:bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-300 group-hover:bg-white rounded-full"></div>
          </div>
        </div>

        <div className={`w-full lg:w-[var(--sidebar-width)] p-0 flex-col bg-white dark:bg-gray-900 shadow-xl z-20 transition-colors duration-300 ${isMobileCalendarOpen ? 'hidden lg:flex' : 'flex'}`}>
          <div className="p-4 sm:p-6 pb-0 border-b border-gray-200 dark:border-gray-800 relative">
            
            <div className="flex space-x-4 mb-6 overflow-x-auto">
              <button 
                onClick={() => setActiveTab("search")}
                className={`pb-3 text-sm font-bold border-b-2 px-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "search" ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                Search
              </button>
              <button 
                onClick={() => setActiveTab("added")}
                className={`pb-3 text-sm font-bold border-b-2 px-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "added" ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                Added ({activeCourses.length}) - {totalUnits} Units
              </button>
            </div>
            
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-24 lg:pb-6 relative">
            
            {activeTab === "search" && (
              <div>
                <div className="mb-6 flex flex-col gap-3">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-[-8px]">Term</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select 
                      value={termQuery}
                      onChange={(e) => setTermQuery(e.target.value)}
                      className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 dark:text-gray-100 font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer w-full sm:w-auto shrink-0"
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
                      className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  {isSearching && <p className="text-orange-500 dark:text-orange-400 text-sm font-bold text-center mt-6 animate-pulse">Searching...</p>}
                  
                  {groupedSearchResults.length === 0 && !isSearching && searchQuery.length > 0 && (
                    <p className="text-gray-500 dark:text-gray-400 text-sm text-center mt-10">No classes found for "{searchQuery}".</p>
                  )}

                  {groupedSearchResults.length === 0 && !isSearching && searchQuery.length === 0 && (
                    <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-10">Start typing to search for classes.</p>
                  )}
                  
                  {groupedSearchResults.map((group) => {
                    const isExpanded = expandedGroups[group.id];
                    
                    return (
                      <div key={group.id} className="border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm bg-white dark:bg-gray-800 overflow-hidden transition-all">
                        <div 
                          className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 flex justify-between items-start sm:items-center"
                          onClick={() => toggleGroup(group.id)}
                        >
                          <div className="flex-1 min-w-0 pr-4">
                            <h2 className="font-extrabold text-blue-900 dark:text-orange-400 text-base sm:text-lg break-words">{group.subject} {group.courseNumber}</h2>
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 break-words">{group.title}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 mt-1 sm:mt-0">
                            <span className="hidden sm:inline-block text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-2.5 py-1 rounded-md border border-orange-100 dark:border-orange-800 pointer-events-none whitespace-nowrap">
                              {group.sections.length} {group.sections.length === 1 ? 'Section' : 'Sections'}
                            </span>
                            <span className="sm:hidden text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded-md border border-orange-100 dark:border-orange-800 pointer-events-none whitespace-nowrap">
                              {group.sections.length}
                            </span>
                            <svg 
                              xmlns="http://www.w3.org/2000/svg" 
                              className={`h-5 w-5 text-gray-400 dark:text-gray-500 transition-transform duration-200 pointer-events-none ${isExpanded ? 'rotate-180' : ''}`} 
                              viewBox="0 0 20 20" 
                              fill="currentColor"
                            >
                              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 p-2 sm:p-3 space-y-2 border-t border-gray-200 dark:border-gray-700">
                            {group.sections.map((section: any) => {
                              const isAdded = activeCourses.some((c) => c.crn === section.crn);
                              
                              let allTags = section.meetings?.map((m: any) => {
                                if (m.days && m.days.length > 0) {
                                  const start = formatTimeDisplay(m.startTime, is24Hour);
                                  const end = formatTimeDisplay(m.endTime, is24Hour);
                                  return end ? `${m.days.join("")} ${start} - ${end}` : `${m.days.join("")} ${start}`;
                                }
                                return "ONLINE";
                              }) || [];
                              
                              if (allTags.length === 0) allTags = ["ONLINE"];
                              const uniqueTags = Array.from(new Set(allTags));

                              const profName = section.professors?.[0];
                              const rmpUrl = getRmpUrl(profName);

                              return (
                                <div key={section.crn} className="flex flex-col sm:flex-row justify-between items-start bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm gap-3 sm:gap-0">
                                  <div className="w-full sm:w-auto flex-1 min-w-0 pr-4">
                                    <div className="flex flex-wrap gap-1 mb-1.5 w-full">
                                      {uniqueTags.map((tag: string, i: number) => (
                                        <span key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold ${tag === 'ONLINE' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                                          {tag}
                                        </span>
                                      ))}
                                      
                                      {rmpUrl ? (
                                        <a 
                                          href={rmpUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-bold bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200 dark:hover:bg-purple-800 transition-colors cursor-pointer"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {profName}
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-75" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                                            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                                          </svg>
                                        </a>
                                      ) : profName && profName.toUpperCase() === "STAFF" ? (
                                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 cursor-default">
                                          STAFF
                                        </span>
                                      ) : null}

                                    </div>
                                    <p className="text-[10px] text-gray-500 font-mono font-medium">
                                      CRN: {section.crn} • {(section.maxEnrollment || 0) - (section.seatsAvailable || 0)}/{section.maxEnrollment || 0} Enrolled
                                    </p>
                                  </div>
                                  <div className="shrink-0 flex items-center justify-end w-full sm:w-auto mt-2 sm:mt-0">
                                    {isAdded ? (
                                      <button onClick={() => removeCourseFromSchedule(section)} className="w-full sm:w-auto bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 p-2 rounded-md transition-colors text-center cursor-pointer flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                      </button>
                                    ) : (
                                      <button onClick={() => addCourseToSchedule(section)} className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 text-white text-xl font-black py-1 px-4 rounded-md transition-colors shadow-sm text-center cursor-pointer flex items-center justify-center">
                                        +
                                      </button>
                                    )}
                                  </div>
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
                      <button onClick={clearActiveSchedule} className="text-xs font-bold text-red-500 hover:text-red-700 underline cursor-pointer">
                        Clear This Schedule
                      </button>
                   </div>
                )}
                {activeCourses.length === 0 ? (
                  <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-10">This schedule is empty.</p>
                ) : (
                  activeCourses.map((course) => <CourseCard key={course.crn} course={course} isAdded={true} />)
                )}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* DETAILED INFO MODAL */}
      {selectedEvent && (() => {
        const isCustomEvent = selectedEvent.courseInfo?.crn?.startsWith("CUS-");

        let location = "TBA";
        if (selectedEvent.meetingInfo?.building || selectedEvent.meetingInfo?.room) {
          const bldg = selectedEvent.meetingInfo.building || "";
          const room = selectedEvent.meetingInfo.room || "";
          if (bldg.toUpperCase() === "ONLINE") {
            location = "ONLINE";
          } else {
            location = `${bldg} ${room}`.trim();
          }
        } else if (selectedEvent.meetingInfo?.location) {
          location = selectedEvent.meetingInfo.location;
        } else if (selectedEvent.courseInfo?.location) {
          location = selectedEvent.courseInfo.location;
        }

        const instructors = selectedEvent.courseInfo?.professors?.length > 0 
          ? selectedEvent.courseInfo.professors.join(', ') 
          : "STAFF";

        return (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            {isCustomEvent ? (
              <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl p-6 max-w-xs w-full mx-4 border border-gray-200 dark:border-gray-700">
                <h3 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-gray-100 mb-6 truncate">{selectedEvent.title}</h3>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      setCustomEventName(selectedEvent.title);
                      setCustomEventStartTime(selectedEvent.meetingInfo.startTime);
                      setCustomEventEndTime(selectedEvent.meetingInfo.endTime);
                      setCustomEventDays(selectedEvent.meetingInfo.days);
                      setCustomEventScheduleId(activeScheduleId);
                      setEditingCustomEventCrn(selectedEvent.courseInfo.crn);
                      setIsCustomEventModalOpen(true);
                      setSelectedEvent(null);
                    }} 
                    className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg font-bold transition-colors shadow-sm cursor-pointer"
                  >
                    Edit Event
                  </button>
                  <button 
                    onClick={() => { removeCourseFromSchedule(selectedEvent.courseInfo); setSelectedEvent(null); }} 
                    className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors shadow-sm cursor-pointer"
                  >
                    Delete Event
                  </button>
                  <button 
                    onClick={() => setSelectedEvent(null)} 
                    className="w-full py-2.5 mt-2 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-lg font-bold transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4 border border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="relative group">
                    <button 
                      onClick={() => {
                        setSearchQuery(selectedEvent.title); 
                        setTermQuery(selectedEvent.courseInfo.term);
                        setActiveTab("search");
                        setSelectedEvent(null);
                      }}
                      className="peer flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold text-lg sm:text-xl text-left transition-colors cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      {selectedEvent.title} {selectedEvent.meetingInfo?.type ? selectedEvent.meetingInfo.type.toUpperCase().substring(0, 3) : "LEC"}
                    </button>
                    <div className="absolute top-[110%] left-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                      Search for this class
                      <div className="absolute bottom-full left-4 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                    </div>
                  </div>
                  
                  <div className="relative group flex items-center justify-center">
                    <button 
                      onClick={() => removeCourseFromSchedule(selectedEvent.courseInfo)} 
                      className="peer text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <div className="absolute top-[110%] right-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                      Remove from schedule
                      <div className="absolute bottom-full right-2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 text-sm sm:text-base">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Section code</span>
                    <span className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-gray-800 dark:text-gray-200 font-mono font-medium">
                      {selectedEvent.courseInfo.crn}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Term</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">{selectedEvent.courseInfo.term}</span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Instructors</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium truncate max-w-[60%] text-right" title={instructors}>
                      {instructors}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Location</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium truncate max-w-[60%] text-right" title={location}>
                      {location}
                    </span>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button 
                    onClick={() => setSelectedEvent(null)} 
                    className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 font-bold transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                </div>

              </div>
            )}
          </div>
        );
      })()}

      {isCustomEventModalOpen && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#2d2d2d] rounded-xl shadow-2xl p-6 max-w-md w-full border border-gray-600 text-white">
            <h3 className="text-xl font-bold mb-6">{editingCustomEventCrn ? "Edit Custom Event" : "Add a Custom Event"}</h3>
            
            <div className="space-y-5">
              
              <div className="relative">
                <input 
                  type="text" 
                  value={customEventName}
                  onChange={(e) => setCustomEventName(e.target.value)}
                  className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 peer cursor-text"
                  placeholder=" "
                />
                <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 transition-all peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-500 peer-placeholder-shown:top-3 peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-gray-300 pointer-events-none">
                  Event Name
                </label>
              </div>

              <div className="flex gap-4">
                <div className="relative flex-1">
                  <input 
                    type="time" 
                    value={customEventStartTime}
                    onChange={(e) => setCustomEventStartTime(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 css-time-input cursor-pointer"
                  />
                  <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 pointer-events-none">Start Time</label>
                </div>
                <div className="relative flex-1">
                  <input 
                    type="time" 
                    value={customEventEndTime}
                    onChange={(e) => setCustomEventEndTime(e.target.value)}
                    className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 css-time-input cursor-pointer"
                  />
                  <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 pointer-events-none">End Time</label>
                </div>
              </div>

              <style dangerouslySetInnerHTML={{__html: `
                .css-time-input::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }
              `}} />

              <div className="flex rounded-md overflow-hidden border border-gray-600 bg-[#1e1e1e]">
                {["Su", "M", "Tu", "W", "Th", "F", "Sa"].map((day, i) => (
                  <button
                    key={day}
                    onClick={() => toggleCustomDay(day)}
                    className={`flex-1 py-2.5 text-xs font-bold border-r border-gray-600 last:border-r-0 transition-colors cursor-pointer ${customEventDays.includes(day) ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
                  >
                    {day.charAt(0)}
                  </button>
                ))}
              </div>

              <div className="relative">
                <select 
                  value={customEventScheduleId || activeScheduleId}
                  onChange={(e) => setCustomEventScheduleId(e.target.value)}
                  className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 appearance-none cursor-pointer"
                >
                  {schedules.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 pointer-events-none">Select schedule</label>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>

            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button 
                onClick={() => setIsCustomEventModalOpen(false)}
                className="px-5 py-2.5 text-sm font-bold text-gray-300 hover:text-white transition-colors cursor-pointer"
              >
                CANCEL
              </button>
              <button 
                onClick={handleAddCustomEvent}
                disabled={!customEventName.trim() || customEventDays.length === 0}
                className={`px-5 py-2.5 text-sm font-bold rounded-md transition-colors cursor-pointer ${!customEventName.trim() || customEventDays.length === 0 ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-[#4a4a4a] text-gray-200 hover:bg-gray-500 hover:text-white'}`}
              >
                {editingCustomEventCrn ? "UPDATE EVENT" : "SAVE EVENT"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 bg-yellow-50 dark:bg-yellow-900/90 border-l-4 border-yellow-500 text-yellow-800 dark:text-yellow-100 p-4 rounded-lg shadow-2xl z-50 flex items-start gap-3 max-w-sm transition-all duration-300 transform translate-y-0 opacity-100 pointer-events-none">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-500 dark:text-yellow-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="font-bold text-sm">Term Mismatch</p>
            <p className="text-xs mt-1 font-medium">{toastMessage}</p>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-yellow-600 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-100 shrink-0 pointer-events-auto cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

    </div>
  );
}