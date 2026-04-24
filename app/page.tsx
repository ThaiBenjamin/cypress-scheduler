"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { toPng } from "html-to-image";
import dynamic from 'next/dynamic';
import { signIn, signOut, useSession } from "next-auth/react";
import { BUILDINGS } from "@/lib/scheduler/buildings";
import CourseCard from "./components/CourseCard";
import "react-big-calendar/lib/css/react-big-calendar.css";

// Safely import the map so it doesn't crash Server Side Rendering
const CourseMap = dynamic(() => import('./CourseMap'), { ssr: false });

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

/** Maps abbreviated meeting day labels to static week dates used by react-big-calendar. */
const dayMap: Record<string, number> = { "Su": 1, "M": 2, "Tu": 3, "W": 4, "Th": 5, "F": 6, "Sa": 7 };

const COURSE_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6"];

function formatTimeDisplay(time24: string, is24Hour: boolean) {
  if (!time24) return "";
  const [hourStr, minStr] = time24.split(":");
  if (!hourStr || !minStr) return time24;
  if (is24Hour) return `${hourStr.padStart(2, '0')}:${minStr}`;
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
  if (parts.length === 2) query = `${parts[1].trim()} ${parts[0].trim()}`;
  return `https://www.ratemyprofessors.com/search/professors?q=${encodeURIComponent(query)}`;
}

/**
 * Converts each meeting occurrence into a visual calendar event block.
 * Events are pinned to a dummy week to make overlap checks deterministic.
 */
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
            title: `${course.subject ? course.subject + ' ' : ''}${course.courseNumber}`.trim(),
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

function CourseStatusBadge({ course }: { course: any }) {
  const seatsAvailable = course.seatsAvailable || 0;
  const waitCount = course.waitCount || 0;
  const waitCapacity = course.waitCapacity || 0;

  if (seatsAvailable > 0) {
    return (
      <span className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
        OPEN ({seatsAvailable} Seat{seatsAvailable !== 1 ? 's' : ''})
      </span>
    );
  }

  if (waitCapacity > 0 && waitCount < waitCapacity) {
    return (
      <span className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-500 border border-yellow-200 dark:border-yellow-800 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
        WAITLIST ({waitCount}/{waitCapacity})
      </span>
    );
  }

  return (
    <span className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
      FULL
    </span>
  );
}

type Schedule = { id: string; name: string; courses: any[]; };
type HistoryState = { schedules: Schedule[]; activeId: string; };
type Theme = "light" | "dark" | "system";

function createDefaultScheduleState() {
  const defaultId = Date.now().toString();
  const defaultSchedules = [{ id: defaultId, name: "Plan 1", courses: [] }];
  return { defaultId, defaultSchedules };
}

export default function Home() {
  const [initialScheduleState] = useState(createDefaultScheduleState);
  const [searchQuery, setSearchQuery] = useState(""); 
  const [termQuery, setTermQuery] = useState("2026-Winter/Spring"); 
  
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "added" | "map">("search");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [isLoaded, setIsLoaded] = useState(false); 
  const calendarRef = useRef<HTMLDivElement>(null);

  const [schedules, setSchedules] = useState<Schedule[]>(initialScheduleState.defaultSchedules);
  const [activeScheduleId, setActiveScheduleId] = useState<string>(initialScheduleState.defaultId);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [customColors, setCustomColors] = useState<Record<string, string>>({});

  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    title: true,
    times: true,
    instructors: true,
    status: true,
    crn: true
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<any>(null);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [infoModalCourse, setInfoModalCourse] = useState<any>(null);

  const [past, setPast] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);

  const [isMobileCalendarOpen, setIsMobileCalendarOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>("system");
  
  // MENU STATE
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  
  // REAL NEXT-AUTH STATE
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const { data: session } = useSession();

  const [is24Hour, setIs24Hour] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(33.33); 
  const isDragging = useRef(false);
  const [lastSavedStateString, setLastSavedStateString] = useState<string>(
    JSON.stringify({
      schedules: initialScheduleState.defaultSchedules,
      activeId: initialScheduleState.defaultId,
    })
  );

  const [isCustomEventModalOpen, setIsCustomEventModalOpen] = useState(false);
  const [customEventName, setCustomEventName] = useState("");
  const [customEventStartTime, setCustomEventStartTime] = useState("10:30");
  const [customEventEndTime, setCustomEventEndTime] = useState("15:30");
  const [customEventDays, setCustomEventDays] = useState<string[]>([]);
  const [customEventBuilding, setCustomEventBuilding] = useState<string>(""); 
  const [customEventScheduleId, setCustomEventScheduleId] = useState<string>("");
  const [editingCustomEventCrn, setEditingCustomEventCrn] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<any>("work_week");

  // Close Settings Menu on Outside Click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setIsSettingsMenuOpen(false);
      }
    };
    if (isSettingsMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSettingsMenuOpen]);

  const getCourseColor = useCallback((crn: string) => {
    if (customColors[crn]) return customColors[crn];
    let hash = 0;
    for (let i = 0; i < crn.length; i++) hash = (Math.imul(31, hash) + crn.charCodeAt(i)) | 0;
    return COURSE_COLORS[Math.abs(hash) % COURSE_COLORS.length];
  }, [customColors]);

  const handleColorChange = (crn: string, newColor: string) => {
    const updatedColors = { ...customColors, [crn]: newColor };
    setCustomColors(updatedColors);
    localStorage.setItem("cypress_custom_colors", JSON.stringify(updatedColors));
  };

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
    setPast(p => [...p, { schedules: JSON.parse(JSON.stringify(schedules)), activeId: activeScheduleId }]);
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

  // Local startup state: schedule data is intentionally not persisted without sign-in.
  useEffect(() => {
    const savedColors = localStorage.getItem("cypress_custom_colors");
    if (savedColors) {
      try { setCustomColors(JSON.parse(savedColors)); } catch {}
    }

    const savedTheme = localStorage.getItem("cypress_theme") as Theme;
    if (savedTheme) setTheme(savedTheme);

    const savedTimeFormat = localStorage.getItem("cypress_time_format");
    if (savedTimeFormat) setIs24Hour(savedTimeFormat === 'true');
    
    const savedSidebarWidth = localStorage.getItem("cypress_sidebar_width");
    if (savedSidebarWidth) setSidebarWidth(parseFloat(savedSidebarWidth));

    setIsLoaded(true);
  }, []);

  // CLOUD STORAGE OVERRIDE LOAD
  useEffect(() => {
    if (session?.user?.email) {
      fetch(`/api/schedules?email=${session.user.email}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            setSchedules(data);
            setActiveScheduleId(data[0].id);
            setLastSavedStateString(JSON.stringify({ schedules: data, activeId: data[0].id }));
          }
        })
        .catch((err) => console.error("Failed to load cloud schedules", err));
    }
  }, [session?.user?.email]);

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

  const handleGoogleSignIn = () => {
    signIn('google');
  };

  const handleSignOut = async () => {
    // Reset the live screen to a blank slate when leaving an authenticated session.
    const { defaultId, defaultSchedules } = createDefaultScheduleState();
    setSchedules(defaultSchedules);
    setActiveScheduleId(defaultId);
    setLastSavedStateString(JSON.stringify({ schedules: defaultSchedules, activeId: defaultId }));

    // Close the menu and terminate the Google session.
    setIsSettingsMenuOpen(false);
    await signOut();
  };

  const handleSaveSchedule = async () => {
    const userEmail = session?.user?.email;
    if (!userEmail) {
      setIsSignInModalOpen(true);
      return;
    }

    try {
      await Promise.all(
        schedules.map((sched) =>
          fetch('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: sched.id,
              userEmail,
              name: sched.name,
              courses: sched.courses,
            }),
          })
        )
      );

      setLastSavedStateString(JSON.stringify({ schedules, activeId: activeScheduleId }));

      setToastMessage("Schedules securely saved to the cloud! ☁️");
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);

    } catch (error) {
      console.error("Failed to save to cloud:", error);
      alert("Something went wrong saving to the cloud. Please try again.");
    }
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
    if (!Array.isArray(searchResults)) return [];
    const groups = new Map<string, any>();
    searchResults.forEach(course => {
      const key = `${course.subject} ${course.courseNumber}`;
      if (!groups.has(key)) {
        groups.set(key, { id: key, subject: course.subject, courseNumber: course.courseNumber, title: course.title, description: course.description, sections: [] });
      }
      groups.get(key).sections.push(course);
    });
    return Array.from(groups.values());
  }, [searchResults]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleCreateNewSchedule = () => {
    const suggestedName = `Plan ${schedules.length + 1}`;
    const newName = window.prompt("Name your new schedule:", suggestedName);
    
    if (!newName || newName.trim() === "") {
      setIsDropdownOpen(false);
      return; 
    }

    saveStateToHistory();
    const newId = Date.now().toString();
    setSchedules([...schedules, { id: newId, name: newName.trim(), courses: [] }]);
    setActiveScheduleId(newId);
    setIsDropdownOpen(false);
  };

  const handleCopySchedule = () => {
    if (!activeSchedule) return;
    const suggestedName = `Copy of ${activeSchedule.name}`;
    const newName = window.prompt("Name your copied schedule:", suggestedName);
    
    if (!newName || newName.trim() === "") return;

    saveStateToHistory();
    const newId = Date.now().toString();
    setSchedules([...schedules, { 
      id: newId, 
      name: newName.trim(), 
      courses: JSON.parse(JSON.stringify(activeSchedule.courses)) 
    }]);
    setActiveScheduleId(newId);
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
      if (activeScheduleId === id) setActiveScheduleId(updatedSchedules[0].id); 
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
      toastTimerRef.current = setTimeout(() => setToastMessage(null), 5000);
    }
    saveStateToHistory();
    setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, courses: [...s.courses, course] } : s));
  };

  const removeCourseFromSchedule = (course: any) => {
    saveStateToHistory();
    setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, courses: s.courses.filter(c => c.crn !== course.crn) } : s));
    setSelectedEvent(null);
  };

  const clearActiveSchedule = () => {
    if (window.confirm(`Clear all classes from "${activeSchedule?.name}"?`)) {
      saveStateToHistory();
      setSchedules(prev => prev.map(s => s.id === activeScheduleId ? { ...s, courses: [] } : s));
    }
  };

  const performSearch = useCallback(async (query: string, term: string) => {
    if (!query.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/courses?q=${encodeURIComponent(query)}&term=${term}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setSearchResults(data);
        if (data.length > 0) {
          const firstKey = `${data[0].subject} ${data[0].courseNumber}`;
          setExpandedGroups({ [firstKey]: true });
        } else {
          setExpandedGroups({});
        }
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error("Search failed", err);
      setSearchResults([]);
    }
    setIsSearching(false);
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => performSearch(searchQuery, termQuery), 300);
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
      if (bldg.toUpperCase() === "ONLINE") location = "ONLINE";
      else location = `${bldg} ${room}`.trim();
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
    if (!customEventName.trim()) { alert("Please enter an event name."); return; }
    if (customEventDays.length === 0) { alert("Please select at least one day."); return; }

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
          type: "Event",
          building: customEventBuilding 
        }
      ]
    };

    saveStateToHistory();
    
    if (editingCustomEventCrn) {
      setSchedules(prev => prev.map(s => s.id === targetScheduleId ? { ...s, courses: s.courses.map(c => c.crn === editingCustomEventCrn ? fakeCourse : c) } : s));
    } else {
      setSchedules(prev => prev.map(s => s.id === targetScheduleId ? { ...s, courses: [...s.courses, fakeCourse] } : s));
    }
    
    setCustomEventName("");
    setCustomEventDays([]);
    setCustomEventBuilding("");
    setIsCustomEventModalOpen(false);
  };

  const toggleCustomDay = (day: string) => {
    setCustomEventDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  if (!isLoaded) return null; 

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
            disabled={!session || !hasUnsavedChanges}
            title={!session ? "Sign in to save schedules to your account" : "Save schedules"}
            className={`flex items-center gap-2 text-sm font-bold py-1.5 px-3 rounded border transition-all cursor-pointer disabled:cursor-not-allowed ${session && hasUnsavedChanges ? "border-white bg-white/20 hover:bg-white/30 text-white shadow-sm" : "border-transparent bg-transparent text-white/50"}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
            <span className="hidden sm:inline">{session ? "SAVE" : "SIGN IN TO SAVE"}</span>
          </button>

          {/* UNIFIED SETTINGS / USER MENU CONTAINER */}
          <div className="relative flex items-center justify-center gap-2" ref={settingsMenuRef}>
            
            {!session ? (
              <button onClick={() => setIsSignInModalOpen(true)} className="flex items-center gap-2 text-sm font-bold py-1.5 px-3 rounded transition-colors hover:bg-white/20 cursor-pointer">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" /></svg>
                <span className="hidden sm:inline tracking-wider">SIGN IN</span>
              </button>
            ) : (
              <button onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)} className="flex items-center justify-center w-8 h-8 bg-white/20 rounded-full font-bold text-sm transition-colors hover:bg-white/30 cursor-pointer shadow-sm" title="Profile Settings">
                {session.user?.name?.charAt(0).toUpperCase() || "U"}
              </button>
            )}

            <button onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)} className="peer p-1.5 hover:bg-white/20 rounded transition-colors cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>

            {!isSettingsMenuOpen && (
              <div className="absolute top-[120%] right-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">
                Settings<div className="absolute bottom-full right-2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div>
              </div>
            )}

            {/* NEW UNIFIED SETTINGS DROPDOWN */}
            {isSettingsMenuOpen && (
              <div className="absolute top-full right-0 mt-3 w-72 bg-[#333333] border border-gray-700 text-white rounded-xl shadow-2xl p-5 z-50 flex flex-col text-left cursor-default">
                
                {session && (
                  <div className="flex items-center gap-4 mb-5">
                    <div className="flex items-center justify-center w-14 h-14 bg-slate-500 rounded-full font-bold text-2xl text-white shrink-0">
                      {session.user?.name?.charAt(0).toUpperCase() || "U"}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-lg truncate leading-tight">{session.user?.name || "User"}</span>
                      <span className="text-gray-400 text-sm truncate">{session.user?.email || "user@example.com"}</span>
                    </div>
                  </div>
                )}

                <h3 className="text-lg font-bold mb-3">Theme</h3>
                <div className="flex rounded-md overflow-hidden border border-gray-600 mb-6 bg-[#2d2d2d]">
                  <button onClick={() => setTheme('light')} className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer ${theme === 'light' ? 'bg-[#3b82f6] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>☀️ Light</button>
                  <button onClick={() => setTheme('system')} className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-1.5 border-l border-r border-gray-600 cursor-pointer ${theme === 'system' ? 'bg-[#3b82f6] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>⚙️ System</button>
                  <button onClick={() => setTheme('dark')} className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer ${theme === 'dark' ? 'bg-[#3b82f6] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>🌙 Dark</button>
                </div>

                <h3 className="text-lg font-bold mb-3">Time</h3>
                <div className="flex rounded-md overflow-hidden border border-gray-600 mb-4 bg-[#2d2d2d]">
                  <button onClick={() => setIs24Hour(false)} className={`flex-1 py-2 text-sm font-bold transition-colors cursor-pointer ${!is24Hour ? 'bg-[#3b82f6] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>12 Hour</button>
                  <button onClick={() => setIs24Hour(true)} className={`flex-1 py-2 text-sm font-bold border-l border-gray-600 transition-colors cursor-pointer ${is24Hour ? 'bg-[#3b82f6] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>24 Hour</button>
                </div>

                {session && (
                  <>
                    <div className="border-t border-gray-600 my-4"></div>
                    <button onClick={handleSignOut} className="flex items-center gap-4 py-2 text-sm font-bold text-white hover:text-gray-300 transition-colors cursor-pointer w-full text-left">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" /></svg>
                      LOG OUT
                    </button>
                  </>
                )}

              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="lg:hidden fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
        <button onClick={() => setIsMobileCalendarOpen(!isMobileCalendarOpen)} className="bg-gray-900 dark:bg-orange-600 text-white px-6 py-3 rounded-full shadow-2xl font-bold flex items-center gap-2 active:scale-95 transition-transform border border-gray-700 dark:border-orange-500 cursor-pointer">
          {isMobileCalendarOpen ? (
            <><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>Back to Search</>
          ) : (
            <><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>View Calendar</>
          )}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative" style={{ '--sidebar-width': `${sidebarWidth}%` } as React.CSSProperties}>
        
        {/* CALENDAR AREA */}
        <div className={`w-full lg:w-[calc(100%-var(--sidebar-width))] p-4 lg:p-8 flex-col z-10 transition-colors duration-300 overflow-y-auto ${isMobileCalendarOpen ? 'flex' : 'hidden lg:flex'}`}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4 sm:gap-0">
            <div className="relative group">
              <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="peer flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 text-sm font-bold py-1.5 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer">
                <span className="truncate max-w-[150px]">{activeSchedule?.name || "Loading..."}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden z-[60]">
                  <div className="max-h-60 overflow-y-auto">
                    {schedules.map(schedule => (
                      <div key={schedule.id} className={`flex items-center justify-between p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-orange-50 dark:hover:bg-gray-700 cursor-pointer ${activeScheduleId === schedule.id ? 'bg-orange-50 dark:bg-gray-700 border-l-4 border-l-orange-600' : 'border-l-4 border-l-transparent'}`} onClick={() => { setActiveScheduleId(schedule.id); setIsDropdownOpen(false); }}>
                        <span className="font-bold text-gray-800 dark:text-gray-200 text-sm flex-1 truncate pr-2">{schedule.name}</span>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={(e) => { e.stopPropagation(); handleRenameSchedule(schedule.id, schedule.name); }} className="text-gray-400 hover:text-orange-600 p-1 cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(schedule.id); }} className="text-gray-400 hover:text-red-600 p-1 cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={handleCreateNewSchedule} className="w-full p-4 text-sm font-bold text-orange-600 dark:text-orange-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center gap-2 cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>Add New Schedule
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 sm:gap-2 text-gray-500 dark:text-gray-400 w-full sm:w-auto">
              <div className="relative flex items-center justify-center">
                <button onClick={exportCalendarAsImage} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Save as PNG<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
              </div>
              <div className="relative flex items-center justify-center">
                <button onClick={exportCalendarAsIcs} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4M12 14v-8m0 8l-4-4m4 4l4-4" /></svg></button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Download as .ics file<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
              </div>
              <div className="relative flex items-center justify-center">
                <button onClick={undo} disabled={past.length === 0} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg></button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Undo<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
              </div>
              <div className="relative flex items-center justify-center">
                <button onClick={redo} disabled={future.length === 0} className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg></button>
                <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Redo<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
              </div>
              <div className="relative flex items-center justify-center">
                <button 
                  onClick={() => {
                    setCustomEventName("");
                    setCustomEventStartTime("10:30");
                    setCustomEventEndTime("15:30");
                    setCustomEventDays([]);
                    setCustomEventBuilding(""); 
                    setCustomEventScheduleId(activeScheduleId);
                    setEditingCustomEventCrn(null);
                    setIsCustomEventModalOpen(true);
                  }}
                  className="peer p-2 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                </button>
                <div className="absolute top-[110%] right-0 transform opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Add Custom Event<div className="absolute bottom-full right-3 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
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
                style: { backgroundColor: getCourseColor(event.courseInfo.crn), borderRadius: "4px", border: "none", padding: "1px 4px", cursor: "pointer" }
              })}
            />
          </div>
        </div>

        <div onMouseDown={startDrag} className="hidden lg:flex w-2 cursor-col-resize bg-gray-200 dark:bg-gray-800 hover:bg-orange-400 dark:hover:bg-orange-500 items-center justify-center z-30 flex-shrink-0 group border-l border-r border-gray-300 dark:border-gray-700 hover:border-orange-400 dark:hover:border-orange-500 transition-colors">
          <div className="flex flex-col gap-1.5 opacity-40 group-hover:opacity-100 pointer-events-none">
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-300 group-hover:bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-300 group-hover:bg-white rounded-full"></div>
            <div className="w-1 h-1 bg-gray-600 dark:bg-gray-300 group-hover:bg-white rounded-full"></div>
          </div>
        </div>

        <div className={`w-full lg:w-[var(--sidebar-width)] p-0 flex-col bg-white dark:bg-gray-900 shadow-xl z-20 transition-colors duration-300 ${isMobileCalendarOpen ? 'hidden lg:flex' : 'flex'}`}>
          
          <div className="p-4 sm:p-6 pb-0 relative">
            <div className="flex w-full mb-6 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
              <button 
                onClick={() => setActiveTab("search")} 
                className={`flex-1 flex justify-center items-center gap-1.5 pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "search" ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                Search
              </button>
              <button 
                onClick={() => setActiveTab("added")} 
                className={`flex-1 flex justify-center items-center gap-1.5 pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "added" ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
                Added
              </button>
              <button 
                onClick={() => setActiveTab("map")} 
                className={`flex-1 flex justify-center items-center gap-1.5 pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "map" ? "border-orange-600 text-orange-600 dark:border-orange-500 dark:text-orange-500" : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
                Map
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 pt-0 pb-24 lg:pb-6 relative flex flex-col">
            {activeTab === "search" && (
              <div>
                <div className="mb-6 flex flex-col gap-3">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-[-8px]">Term</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select value={termQuery} onChange={(e) => setTermQuery(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 dark:text-gray-100 font-medium focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer w-full sm:w-auto shrink-0">
                      <option value="2026-Fall">Fall 2026</option>
                      <option value="2026-Summer">Summer 2026</option>
                      <option value="2026-Winter/Spring">Winter/Spring 2026</option>
                    </select>
                    <input type="text" placeholder="Search by Title, Subject, or CRN..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                </div>
                <div className="space-y-4">
                  {isSearching && <p className="text-orange-500 dark:text-orange-400 text-sm font-bold text-center mt-6 animate-pulse">Searching...</p>}
                  {groupedSearchResults.length === 0 && !isSearching && searchQuery.length > 0 && <p className="text-gray-500 dark:text-gray-400 text-sm text-center mt-10">No classes found for "{searchQuery}".</p>}
                  {groupedSearchResults.length === 0 && !isSearching && searchQuery.length === 0 && <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-10">Start typing to search for classes.</p>}
                  {groupedSearchResults.map((group) => {
                    const isExpanded = expandedGroups[group.id];
                    return (
                      <div key={group.id} className="border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm bg-white dark:bg-gray-800 overflow-hidden transition-all">
                        <div className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 flex justify-between items-start sm:items-center" onClick={() => toggleGroup(group.id)}>
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="flex items-center gap-2 mb-0.5">
                              <h2 className="font-extrabold text-blue-900 dark:text-orange-400 text-base sm:text-lg break-words">{group.subject} {group.courseNumber}</h2>
                              <button onClick={(e) => { e.stopPropagation(); setInfoModalCourse(group); }} className="p-1 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer" title="Course Information"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 pointer-events-none"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg></button>
                            </div>
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 break-words">{group.title}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 mt-1 sm:mt-0">
                            <span className="hidden sm:inline-block text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-2.5 py-1 rounded-md border border-orange-100 dark:border-orange-800 pointer-events-none whitespace-nowrap">{group.sections.length} {group.sections.length === 1 ? 'Section' : 'Sections'}</span>
                            <span className="sm:hidden text-xs font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded-md border border-orange-100 dark:border-orange-800 pointer-events-none whitespace-nowrap">{group.sections.length}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-gray-400 dark:text-gray-500 transition-transform duration-200 pointer-events-none ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 p-2 sm:p-3 space-y-2 border-t border-gray-200 dark:border-gray-700">
                            {group.sections.map((section: any) => {
                              const isAdded = activeCourses.some((c) => c.crn === section.crn);
                              let allTags: string[] = section.meetings?.map((m: any) => {
                                if (m.days && m.days.length > 0) {
                                  const start = formatTimeDisplay(m.startTime, is24Hour);
                                  const end = formatTimeDisplay(m.endTime, is24Hour);
                                  return end ? `${m.days.join("")} ${start} - ${end}` : `${m.days.join("")} ${start}`;
                                }
                                return "ONLINE";
                              }) || [];
                              if (allTags.length === 0) allTags = ["ONLINE"];
                              const uniqueTags: string[] = Array.from(new Set(allTags));
                              const profName = section.professors?.[0];
                              const rmpUrl = getRmpUrl(profName);

                              return (
                                <div key={section.crn} className="flex flex-col sm:flex-row justify-between items-start bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm gap-3 sm:gap-0">
                                  <div className="w-full sm:w-auto flex-1 min-w-0 pr-4">
                                    <div className="flex flex-wrap gap-1 mb-1.5 w-full">
                                      {uniqueTags.map((tag: string, i: number) => (
                                        <span key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold border ${tag === 'ONLINE' ? 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/30 dark:border-orange-800 dark:text-orange-300' : 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-300'}`}>{tag}</span>
                                      ))}
                                      {rmpUrl ? (
                                        <a href={rmpUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-bold bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200 dark:hover:bg-purple-800 transition-colors cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                          {profName}
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-75 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                                        </a>
                                      ) : profName && profName.toUpperCase() === "STAFF" ? (
                                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 cursor-default">STAFF</span>
                                      ) : null}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                      <CourseStatusBadge course={section} />
                                      <p className="text-[10px] text-gray-500 font-mono font-medium">CRN: {section.crn} • {(section.maxEnrollment || 0) - (section.seatsAvailable || 0)}/{section.maxEnrollment || 0} Enrolled</p>
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex items-center justify-end w-full sm:w-auto mt-2 sm:mt-0">
                                    {isAdded ? (
                                      <button onClick={() => removeCourseFromSchedule(section)} className="w-full sm:w-auto bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 p-2 rounded-md transition-colors text-center cursor-pointer flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 pointer-events-none"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                      </button>
                                    ) : (
                                      <button onClick={() => addCourseToSchedule(section)} className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 text-white text-xl font-black py-1 px-4 rounded-md transition-colors shadow-sm text-center cursor-pointer flex items-center justify-center">+</button>
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

            {/* ADDED TAB */}
            {activeTab === "added" && (
              <div className="space-y-4 relative">
                
                {/* STICKY ACTION HEADER */}
                <div className="sticky top-0 z-40 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-xl py-3 border-b border-gray-200 dark:border-gray-800 -mx-4 px-4 sm:-mx-6 sm:px-6 mb-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    
                    {/* Copy Button */}
                    <div className="relative group">
                      <button onClick={handleCopySchedule} className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 cursor-pointer transition-transform hover:scale-105 active:scale-95">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>
                      </button>
                      <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Copy Schedule<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>

                    {/* Clear/Trash Button */}
                    <div className="relative group">
                      <button onClick={clearActiveSchedule} className="w-10 h-10 rounded-full bg-white dark:bg-gray-800 shadow-sm flex items-center justify-center text-gray-700 dark:text-gray-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 border border-gray-200 dark:border-gray-700 cursor-pointer transition-all hover:scale-105 active:scale-95">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                      <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Clear Schedule<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>

                    {/* Column Visibility Toggle */}
                    <div className="relative group">
                      <button onClick={() => setIsColumnDropdownOpen(!isColumnDropdownOpen)} className={`w-10 h-10 rounded-full shadow-sm flex items-center justify-center border cursor-pointer transition-all hover:scale-105 active:scale-95 ${isColumnDropdownOpen ? 'bg-orange-100 text-orange-600 border-orange-300 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-400' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                      </button>
                      
                      {!isColumnDropdownOpen && (
                        <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Show/Hide Info<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                      )}

                      {/* Dropdown Menu */}
                      {isColumnDropdownOpen && (
                        <div className="absolute top-[120%] left-0 mt-2 w-48 bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 py-2 z-50 overflow-hidden">
                          <div className="px-4 py-1.5 text-[10px] font-black text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 mb-1 bg-gray-50 dark:bg-gray-900/50">Visible Info</div>
                          {Object.entries(visibleColumns).map(([key, isVisible]) => (
                            <label key={key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50 dark:hover:bg-gray-700 cursor-pointer transition-colors">
                              <input 
                                type="checkbox" 
                                checked={isVisible} 
                                onChange={() => setVisibleColumns(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))} 
                                className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500 cursor-pointer border-gray-300 dark:border-gray-600 dark:bg-gray-800" 
                              />
                              <span className="text-sm font-bold text-gray-700 dark:text-gray-200 capitalize select-none">{key}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Plan Name & Units */}
                  <div>
                    <h2 className="text-lg sm:text-xl font-black text-gray-800 dark:text-gray-200 tracking-tight">
                      {activeSchedule?.name || "My Plan"} <span className="text-gray-500 dark:text-gray-400 font-bold text-base">({totalUnits} Units)</span>
                    </h2>
                  </div>
                </div>

                {activeCourses.length === 0 ? (
                  <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-10">This schedule is empty.</p>
                ) : (
                  activeCourses.map((course) => (
                    <CourseCard
                      key={course.crn}
                      course={course}
                      isAdded={true}
                      is24Hour={is24Hour}
                      visibleColumns={visibleColumns}
                      getCourseColor={getCourseColor}
                      formatTimeDisplay={formatTimeDisplay}
                      getRmpUrl={getRmpUrl}
                      onOpenInfo={setInfoModalCourse}
                      onColorChange={handleColorChange}
                      onRemoveCourse={removeCourseFromSchedule}
                      onAddCourse={addCourseToSchedule}
                      renderStatusBadge={(targetCourse) => <CourseStatusBadge course={targetCourse} />}
                    />
                  ))
                )}
              </div>
            )}

            {activeTab === "map" && (
              <div className="flex-1 w-full flex flex-col min-h-[70vh] rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden relative z-0 shadow-sm">
                <CourseMap 
                  activeCourses={activeCourses} 
                  getCourseColor={getCourseColor} 
                  onColorChange={handleColorChange} 
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODALS */}
      {infoModalCourse && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4" onClick={() => setInfoModalCourse(null)}>
          <div className="bg-[#2d2d2d] rounded-xl shadow-2xl p-6 max-w-xl w-full border border-gray-600 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl sm:text-2xl font-black text-white pr-4">{infoModalCourse.title || "Course Information"}</h3>
                <p className="text-gray-400 font-bold mt-1 text-sm">{infoModalCourse.subject} {infoModalCourse.courseNumber}</p>
              </div>
              <button onClick={() => setInfoModalCourse(null)} className="text-gray-400 hover:text-white transition-colors cursor-pointer shrink-0"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
            <div className="text-gray-200 text-sm leading-relaxed mb-6">
              {infoModalCourse.description ? infoModalCourse.description : (
                <div className="bg-orange-900/30 border border-orange-800 text-orange-200 p-4 rounded-lg">
                  <span className="font-bold block mb-2">Description missing!</span>
                  Your API route is not sending the <code>description</code> field to the frontend. <br/><br/>
                  Open your <code>app/api/courses/route.ts</code> (or similar file) and ensure <code>description: true</code> is included in your Prisma <code>select</code> statement so it reaches this page!
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setInfoModalCourse(null)} className="px-6 py-2.5 text-sm font-bold bg-[#4a4a4a] text-gray-200 hover:bg-gray-500 hover:text-white rounded-md transition-colors cursor-pointer shadow-sm">CLOSE</button>
            </div>
          </div>
        </div>
      )}

      {selectedEvent && (() => {
        const isCustomEvent = selectedEvent.courseInfo?.crn?.startsWith("CUS-");
        let location = "TBA";
        if (selectedEvent.meetingInfo?.building || selectedEvent.meetingInfo?.room) {
          const bldg = selectedEvent.meetingInfo.building || "";
          const room = selectedEvent.meetingInfo.room || "";
          if (bldg.toUpperCase() === "ONLINE") location = "ONLINE";
          else location = `${bldg} ${room}`.trim();
        } else if (selectedEvent.meetingInfo?.location) {
          location = selectedEvent.meetingInfo.location;
        } else if (selectedEvent.courseInfo?.location) {
          location = selectedEvent.courseInfo.location;
        }
        const instructors = selectedEvent.courseInfo?.professors?.length > 0 ? selectedEvent.courseInfo.professors.join(', ') : "STAFF";

        return (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedEvent(null)}>
            {isCustomEvent ? (
              <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl p-6 max-w-xs w-full mx-4 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-gray-100 truncate pr-2">{selectedEvent.title}</h3>
                  
                  <div className="relative group flex items-center justify-center shrink-0 pt-1">
                    <div 
                      className="peer relative flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500 transition-colors cursor-pointer overflow-hidden shrink-0" 
                      title="Change color"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>
                      <input 
                        type="color" 
                        value={getCourseColor(selectedEvent.courseInfo.crn)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-[200%] h-[200%] -top-1/2 -left-1/2" 
                        onChange={(e) => handleColorChange(selectedEvent.courseInfo.crn, e.target.value)} 
                      />
                    </div>
                    <div className="absolute top-[110%] right-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Change Color<div className="absolute bottom-full right-2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      setCustomEventName(selectedEvent.title);
                      setCustomEventStartTime(selectedEvent.meetingInfo.startTime);
                      setCustomEventEndTime(selectedEvent.meetingInfo.endTime);
                      setCustomEventDays(selectedEvent.meetingInfo.days);
                      setCustomEventBuilding(selectedEvent.meetingInfo.building || "");
                      setCustomEventScheduleId(activeScheduleId);
                      setEditingCustomEventCrn(selectedEvent.courseInfo.crn);
                      setIsCustomEventModalOpen(true);
                      setSelectedEvent(null);
                    }} 
                    className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg font-bold transition-colors shadow-sm cursor-pointer"
                  >
                    Edit Event
                  </button>
                  <button onClick={() => { removeCourseFromSchedule(selectedEvent.courseInfo); setSelectedEvent(null); }} className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors shadow-sm cursor-pointer">Delete Event</button>
                  <button onClick={() => setSelectedEvent(null)} className="w-full py-2.5 mt-2 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-lg font-bold transition-colors cursor-pointer">Close</button>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4 border border-gray-200 dark:border-gray-700" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                  <div className="relative group">
                    <button onClick={() => { setSearchQuery(selectedEvent.title); setTermQuery(selectedEvent.courseInfo.term); setActiveTab("search"); setSelectedEvent(null); }} className="peer flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold text-lg sm:text-xl text-left transition-colors cursor-pointer">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      {selectedEvent.title} {selectedEvent.meetingInfo?.type ? selectedEvent.meetingInfo.type.toUpperCase().substring(0, 3) : "LEC"}
                    </button>
                    <div className="absolute top-[110%] left-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Search for this class<div className="absolute bottom-full left-4 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0 pt-1">
                    
                    <div className="relative group flex items-center justify-center">
                      <div 
                        className="peer relative flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500 transition-colors cursor-pointer overflow-hidden shrink-0" 
                        title="Change color"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>
                        <input 
                          type="color" 
                          value={getCourseColor(selectedEvent.courseInfo.crn)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-[200%] h-[200%] -top-1/2 -left-1/2" 
                          onChange={(e) => handleColorChange(selectedEvent.courseInfo.crn, e.target.value)} 
                        />
                      </div>
                      <div className="absolute top-[110%] right-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Change Color<div className="absolute bottom-full right-2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>

                    <div className="relative group flex items-center justify-center">
                      <button onClick={() => removeCourseFromSchedule(selectedEvent.courseInfo)} className="peer w-8 h-8 rounded-lg flex items-center justify-center bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer shrink-0"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      <div className="absolute top-[110%] right-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Remove from schedule<div className="absolute bottom-full right-2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>
                  </div>

                </div>
                <div className="space-y-4 text-sm sm:text-base">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Section code</span>
                    <span className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-gray-800 dark:text-gray-200 font-mono font-medium">{selectedEvent.courseInfo.crn}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Term</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">{selectedEvent.courseInfo.term}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Instructors</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium truncate max-w-[60%] text-right" title={instructors}>{instructors}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-700 dark:text-gray-300">Location</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium truncate max-w-[60%] text-right" title={location}>{location}</span>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button onClick={() => setSelectedEvent(null)} className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-gray-700 dark:text-gray-300 font-bold transition-colors cursor-pointer">Close</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* SIGN IN MODAL */}
      {isSignInModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={() => setIsSignInModalOpen(false)}>
          <div className="bg-[#2d2d2d] rounded-xl shadow-2xl p-8 w-full max-w-md border border-gray-700 flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-white mb-6 text-center tracking-wide">Sign in to save your schedules</h3>
            
            <button onClick={handleGoogleSignIn} className="w-full bg-[#1565c0] hover:bg-[#0d47a1] text-white font-bold py-3.5 px-4 rounded-lg flex items-center justify-center gap-3 transition-colors shadow-lg cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="24px" height="24px"><path fill="#fff" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/></svg>
              SIGN IN WITH GOOGLE
            </button>

            <div className="mt-8 flex items-center text-gray-400 text-xs w-full">
              <div className="flex-1 border-t border-gray-600"></div>
              <span className="px-3 cursor-pointer hover:text-white transition-colors flex items-center gap-1 font-medium">
                Have schedules saved to an old user ID? 
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
              </span>
              <div className="flex-1 border-t border-gray-600"></div>
            </div>

            <div className="mt-10 flex justify-end">
              <button onClick={() => setIsSignInModalOpen(false)} className="text-sm font-bold text-gray-400 hover:text-white transition-colors cursor-pointer">CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {isCustomEventModalOpen && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-[#2d2d2d] rounded-xl shadow-2xl p-6 max-w-md w-full border border-gray-600 text-white">
            <h3 className="text-xl font-bold mb-6">{editingCustomEventCrn ? "Edit Custom Event" : "Add a Custom Event"}</h3>
            
            <div className="space-y-5">
              <div className="relative">
                <input type="text" value={customEventName} onChange={(e) => setCustomEventName(e.target.value)} className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 peer cursor-text" placeholder=" " />
                <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 transition-all peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-500 peer-placeholder-shown:top-3 peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-gray-300 pointer-events-none">Event Name</label>
              </div>

              <div className="relative">
                <select 
                  value={customEventBuilding}
                  onChange={(e) => setCustomEventBuilding(e.target.value)}
                  className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 appearance-none cursor-pointer"
                >
                  <option value="">No Location (TBA)</option>
                  {Object.entries(BUILDINGS).map(([code, building]) => (
                    <option key={code} value={code}>{building.name} ({code})</option>
                  ))}
                </select>
                <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 pointer-events-none">Location (Map Pin)</label>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="relative flex-1">
                  <input type="time" value={customEventStartTime} onChange={(e) => setCustomEventStartTime(e.target.value)} className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 css-time-input cursor-pointer" />
                  <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 pointer-events-none">Start Time</label>
                </div>
                <div className="relative flex-1">
                  <input type="time" value={customEventEndTime} onChange={(e) => setCustomEventEndTime(e.target.value)} className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 css-time-input cursor-pointer" />
                  <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 pointer-events-none">End Time</label>
                </div>
              </div>

              <style dangerouslySetInnerHTML={{__html: `.css-time-input::-webkit-calendar-picker-indicator { filter: invert(1); cursor: pointer; }`}} />

              <div className="flex rounded-md overflow-hidden border border-gray-600 bg-[#1e1e1e]">
                {["Su", "M", "Tu", "W", "Th", "F", "Sa"].map((day, i) => (
                  <button key={day} onClick={() => toggleCustomDay(day)} className={`flex-1 py-2.5 text-xs font-bold border-r border-gray-600 last:border-r-0 transition-colors cursor-pointer ${customEventDays.includes(day) ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}>{day.charAt(0)}</button>
                ))}
              </div>

              <div className="relative">
                <select value={customEventScheduleId || activeScheduleId} onChange={(e) => setCustomEventScheduleId(e.target.value)} className="w-full bg-[#1e1e1e] border border-gray-600 rounded-md px-4 py-3 text-sm focus:outline-none focus:border-gray-400 appearance-none cursor-pointer">
                  {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <label className="absolute left-3 -top-2.5 bg-[#2d2d2d] px-1 text-xs text-gray-400 pointer-events-none">Select schedule</label>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none"><svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg></div>
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button onClick={() => setIsCustomEventModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-gray-300 hover:text-white transition-colors cursor-pointer">CANCEL</button>
              <button onClick={handleAddCustomEvent} disabled={!customEventName.trim() || customEventDays.length === 0} className={`px-5 py-2.5 text-sm font-bold rounded-md transition-colors cursor-pointer ${!customEventName.trim() || customEventDays.length === 0 ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-[#4a4a4a] text-gray-200 hover:bg-gray-500 hover:text-white'}`}>{editingCustomEventCrn ? "UPDATE EVENT" : "SAVE EVENT"}</button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 bg-yellow-50 dark:bg-yellow-900/90 border-l-4 border-yellow-500 text-yellow-800 dark:text-yellow-100 p-4 rounded-lg shadow-2xl z-50 flex items-start gap-3 max-w-sm transition-all duration-300 transform translate-y-0 opacity-100 pointer-events-none">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-500 dark:text-yellow-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div className="flex-1"><p className="font-bold text-sm">Term Mismatch</p><p className="text-xs mt-1 font-medium">{toastMessage}</p></div>
          <button onClick={() => setToastMessage(null)} className="text-yellow-600 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-100 shrink-0 pointer-events-auto cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      )}
    </div>
  );
}
