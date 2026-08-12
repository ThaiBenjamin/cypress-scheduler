"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import dynamic from 'next/dynamic';
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { BUILDINGS } from "@/lib/scheduler/buildings";
import { buildIcsCalendar } from "@/lib/ics";
import CourseCard from "./components/CourseCard";
import "react-big-calendar/lib/css/react-big-calendar.css";

// Safely import the map so it doesn't crash Server Side Rendering
const CourseMap = dynamic(() => import('./CourseMap'), { ssr: false });

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

/** Maps abbreviated meeting day labels to static week dates used by react-big-calendar. */
const dayMap: Record<string, number> = { "Su": 1, "M": 2, "Tu": 3, "W": 4, "Th": 5, "F": 6, "Sa": 7 };

const COURSE_COLORS = ["#1A4C93", "#C77700", "#2E7D6B", "#5B4B8A", "#B0413E", "#5A6779"];
const TERM_ORDER = { "Winter/Spring": 0, "Summer": 1, "Fall": 2 } as const;
const COURSE_HISTORY_LIMIT = 25;

function getBuildingCoordinates(code?: string): { lat: number; lng: number } | null {
  if (!code) return null;
  const found = BUILDINGS[code as keyof typeof BUILDINGS];
  if (!found) return null;
  return { lat: found.coords[0], lng: found.coords[1] };
}

function estimateWalkingMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const distanceMeters = 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
  const averageWalkingSpeedMps = 1.35;
  return Math.ceil(distanceMeters / averageWalkingSpeedMps / 60);
}

function parseTermLabel(term: string): { year: number; season: keyof typeof TERM_ORDER } | null {
  const [yearRaw, seasonRaw] = String(term || "").split("-");
  if (!yearRaw || !seasonRaw || !(seasonRaw in TERM_ORDER)) return null;
  const year = Number(yearRaw);
  if (!Number.isFinite(year)) return null;
  return { year, season: seasonRaw as keyof typeof TERM_ORDER };
}

function getCurrentAcademicTerm(date: Date): { year: number; season: keyof typeof TERM_ORDER } {
  const month = date.getMonth();
  if (month <= 4) return { year: date.getFullYear(), season: "Winter/Spring" };
  if (month <= 7) return { year: date.getFullYear(), season: "Summer" };
  return { year: date.getFullYear(), season: "Fall" };
}

function getDropDeadlineForTerm(year: number, season: keyof typeof TERM_ORDER): Date {
  if (season === "Winter/Spring") return new Date(year, 0, 31, 23, 59, 59, 999);
  if (season === "Summer") return new Date(year, 5, 15, 23, 59, 59, 999);
  return new Date(year, 8, 15, 23, 59, 59, 999);
}

function getNotificationEligibility(term: string, today = new Date()): { allowed: boolean; reason?: string } {
  const target = parseTermLabel(term);
  if (!target) return { allowed: false, reason: "Notifications are only available for standard academic terms." };

  const current = getCurrentAcademicTerm(today);
  const targetRank = target.year * 10 + TERM_ORDER[target.season];
  const currentRank = current.year * 10 + TERM_ORDER[current.season];

  if (targetRank < currentRank) {
    return { allowed: false, reason: "Notifications are only available for the current term (before drop deadline) and future terms." };
  }

  if (targetRank > currentRank) {
    return { allowed: true };
  }

  const dropDeadline = getDropDeadlineForTerm(current.year, current.season);
  if (today.getTime() > dropDeadline.getTime()) {
    return { allowed: false, reason: `The drop deadline has passed for ${term}.` };
  }

  return { allowed: true };
}

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
 * Copies text, falling back to a hidden textarea + execCommand when the async
 * Clipboard API is unavailable or refuses. Safari/iOS rejects writeText when the
 * originating user gesture has already been spent on an await, and the API is
 * absent entirely outside secure contexts. Returns false if nothing worked, so
 * the caller can surface the value for manual copying instead of claiming failure.
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
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

function getCourseAvailabilityStatus(course: any): "OPEN" | "WAITLIST" | "FULL" {
  const seatsAvailable = course.seatsAvailable || 0;
  const waitCount = course.waitCount || 0;
  const waitCapacity = course.waitCapacity || 0;
  if (seatsAvailable > 0) return "OPEN";
  if (waitCapacity > 0 && waitCount < waitCapacity) return "WAITLIST";
  return "FULL";
}

function getRestrictionSignature(course: any): string {
  const restrictionCodes = (course.restrictions || course.restrictionCodes || []).join("|");
  return restrictionCodes || "none";
}

function CourseStatusBadge({ course }: { course: any }) {
  const seatsAvailable = course.seatsAvailable || 0;
  const waitCount = course.waitCount || 0;
  const waitCapacity = course.waitCapacity || 0;

  if (seatsAvailable > 0) {
    return (
      <span className="cy-badge cy-badge-open whitespace-nowrap">
        OPEN ({seatsAvailable} Seat{seatsAvailable !== 1 ? 's' : ''})
      </span>
    );
  }

  if (waitCapacity > 0 && waitCount < waitCapacity) {
    return (
      <span className="cy-badge cy-badge-wait whitespace-nowrap">
        WAITLIST ({waitCount}/{waitCapacity})
      </span>
    );
  }

  return (
    <span className="cy-badge cy-badge-full whitespace-nowrap">
      FULL
    </span>
  );
}

type Schedule = { id: string; name: string; courses: any[]; };
type HistoryState = { schedules: Schedule[]; activeId: string; };
type Theme = "light" | "dark" | "system";
type NotificationFlags = {
  open: boolean;
  waitlist: boolean;
  full: boolean;
  restrictions: boolean;
};
type NotificationWatch = {
  crn: string;
  term: string;
  title: string;
  email: string;
  flags: NotificationFlags;
  lastStatus: "OPEN" | "WAITLIST" | "FULL";
  lastRestrictionSignature: string;
};
type CourseHistoryEvent = {
  crn: string;
  title: string;
  term: string;
  status: "OPEN" | "WAITLIST" | "FULL";
  at: string;
};
type ImportedRegistration = {
  crn: string;
  term: string | null;
  title: string;
};
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};
type OptimizerConstraints = {
  avoidFridays: boolean;
  earliestStartHour: number;
  maxClassesPerDay: number;
};
type OptimizedScheduleOption = {
  id: string;
  courses: any[];
  score: number;
  metrics: {
    fridayClasses: number;
    earliestStartHour: number;
    busiestDayLoad: number;
    campusDays: number;
  };
};
type SearchMode = "quick" | "manual";
type ManualSearchFilters = {
  subject: string;
  courseNumber: string;
  crn: string;
  instructor: string;
  meetingDay: "any" | "M" | "Tu" | "W" | "Th" | "F";
  instructionMode: "any" | "in-person" | "online" | "hybrid";
  availability: "any" | "open" | "waitlist" | "full";
  startAfterHour: "any" | "8" | "9" | "10" | "11" | "12" | "13";
};

function mapImportedTermToApiTerm(rawTerm: string): string | null {
  const normalized = rawTerm.trim();
  const parts = normalized.match(/(Fall|Summer|Winter\/Spring|Spring|Winter)\s+(\d{4})/i);
  if (!parts) return null;
  const seasonRaw = parts[1].toLowerCase();
  const year = parts[2];
  const season =
    seasonRaw === "fall"
      ? "Fall"
      : seasonRaw === "summer"
        ? "Summer"
        : "Winter/Spring";
  return `${year}-${season}`;
}

function parseMyGatewayRegistrations(rawText: string): ImportedRegistration[] {
  const blocks = rawText
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const parsed: ImportedRegistration[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim());
    const firstLine = lines[0] || "";
    const crnLine = lines.find((line) => /^CRN:\s*\d+/i.test(line));
    if (!crnLine) continue;
    const termLine = lines.find((line) => /^Term:\s*/i.test(line));
    const crn = crnLine.replace(/^CRN:\s*/i, "").trim();
    const title = firstLine.split(",")[0]?.trim() || `CRN ${crn}`;
    const rawTerm = termLine ? termLine.replace(/^Term:\s*/i, "").trim() : "";

    parsed.push({
      crn,
      title,
      term: rawTerm ? mapImportedTermToApiTerm(rawTerm) : null,
    });
  }

  return parsed;
}

function getCourseGroupKey(course: any): string {
  return `${course.subject || ""} ${course.courseNumber || ""}`.trim();
}

function getMeetingDays(course: any): string[] {
  if (!Array.isArray(course.meetings)) return [];
  return course.meetings.flatMap((meeting: any) => (Array.isArray(meeting.days) ? meeting.days : []));
}

function getEarliestCourseStartHour(course: any): number | null {
  if (!Array.isArray(course.meetings)) return null;
  const starts = course.meetings
    .map((meeting: any) => meeting.startTime)
    .filter(Boolean)
    .map((start: string) => Number(start.split(":")[0]))
    .filter((hour: number) => Number.isFinite(hour));
  if (starts.length === 0) return null;
  return Math.min(...starts);
}

export default function Home() {
  const [initialScheduleState] = useState(() => {
    const defaultId = Date.now().toString();
    const defaultSchedules = [{ id: defaultId, name: "Plan 1", courses: [] }];
    return { defaultId, defaultSchedules };
  });
  const [searchQuery, setSearchQuery] = useState(""); 
  const [termQuery, setTermQuery] = useState("2026-Winter/Spring"); 
  const [searchMode, setSearchMode] = useState<SearchMode>("quick");
  const [manualSearchHasRun, setManualSearchHasRun] = useState(false);
  const [manualFilters, setManualFilters] = useState<ManualSearchFilters>({
    subject: "",
    courseNumber: "",
    crn: "",
    instructor: "",
    meetingDay: "any",
    instructionMode: "any",
    availability: "any",
    startAfterHour: "any",
  });
  
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // "calendar" only applies below `lg` (mobile bottom tab bar); on desktop the
  // calendar and sidebar sit side by side and this drives the sidebar tabs.
  const [activeTab, setActiveTab] = useState<"calendar" | "search" | "added" | "map">("search");
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
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false);
  const [notificationWatches, setNotificationWatches] = useState<Record<string, NotificationWatch>>({});
  const [notificationModalCourse, setNotificationModalCourse] = useState<any>(null);
  const [courseHistory, setCourseHistory] = useState<CourseHistoryEvent[]>([]);
  const [lastSearchSource, setLastSearchSource] = useState<"db" | "fallback" | null>(null);
  const [lastSearchSourceReason, setLastSearchSourceReason] = useState<string | null>(null);
  const [lastSearchAt, setLastSearchAt] = useState<string | null>(null);

  // The toast carries its own heading — it started life as a term-mismatch-only
  // banner, and every later caller inherited that stale title until it was fixed.
  const [toastMessage, setToastMessage] = useState<{ title: string; body: string } | null>(null);
  const toastTimerRef = useRef<any>(null);

  // Holds the share URL when the clipboard refused it, so the user can copy by hand.
  const [shareFallbackUrl, setShareFallbackUrl] = useState<string | null>(null);

  const showToast = useCallback((title: string, body: string, durationMs = 4000) => {
    setToastMessage({ title, body });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), durationMs);
  }, []);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [infoModalCourse, setInfoModalCourse] = useState<any>(null);

  const [past, setPast] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);

  const [theme, setTheme] = useState<Theme>("system");
  
  // MENU STATE
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialRect, setTutorialRect] = useState<DOMRect | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  
  // REAL NEXT-AUTH STATE
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const { data: session, status } = useSession();
  const router = useRouter();

  // Signed-out visitors land on /welcome first, unless they chose "Try it without
  // signing in" (which sets the cyp_guest flag).
  useEffect(() => {
    if (
      status === "unauthenticated" &&
      typeof window !== "undefined" &&
      localStorage.getItem("cyp_guest") !== "1"
    ) {
      router.replace("/welcome");
    }
  }, [status, router]);

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
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [optimizerConstraints, setOptimizerConstraints] = useState<OptimizerConstraints>({
    avoidFridays: true,
    earliestStartHour: 10,
    maxClassesPerDay: 3,
  });
  const [optimizerLimit, setOptimizerLimit] = useState(5);
  const [optimizerNotice, setOptimizerNotice] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Cypress Scheduler assistant. Ask me about finding classes, building conflict-free schedules, notifications, sharing, or how this app works.",
    },
  ]);
  const tutorialSteps = useMemo(
    () => [
      { title: "Welcome to Cypress Scheduler", body: "Use ← and → keys to navigate this tour. Press Esc to close anytime.", selector: "[data-tour='schedule-dropdown']", placement: "bottom" as const, tab: "search" as const },
      { title: "Choose your plan", body: "Use this plan selector to switch, rename, or manage schedule plans.", selector: "[data-tour='schedule-dropdown']", placement: "bottom" as const, tab: "search" as const },
      { title: "Search tab", body: "Start here to search by term, subject, title, or CRN.", selector: "[data-tour='search-tab']", placement: "bottom" as const, tab: "search" as const },
      { title: "Term filter", body: "Pick the academic term before searching to narrow results.", selector: "[data-tour='term-select']", placement: "bottom" as const, tab: "search" as const },
      { title: "Search input", body: "Type class keywords or CRNs to load matching sections.", selector: "[data-tour='search-input']", placement: "bottom" as const, tab: "search" as const },
      { title: "Added tab", body: "Open Added to review selected sections and edit your plan.", selector: "[data-tour='added-tab']", placement: "bottom" as const, tab: "added" as const },
      { title: "Share link", body: "Use this to copy a compact share link for advisors or friends.", selector: "[data-tour='share-button']", placement: "bottom" as const, tab: "added" as const },
      { title: "Notifications", body: "Track seat openings, waitlist changes, and restriction updates here.", selector: "[data-tour='notification-button']", placement: "bottom" as const, tab: "added" as const },
      { title: "Map tab", body: "Visualize where classes are located and compare routes across days.", selector: "[data-tour='map-tab']", placement: "bottom" as const, tab: "map" as const },
      { title: "Done", body: "You can relaunch this walkthrough from Settings → Start quick tutorial.", selector: "[data-tour='settings-button']", placement: "bottom" as const, tab: "search" as const },
    ],
    []
  );

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

  useEffect(() => {
    if (!isTutorialOpen) return;
    const targetTab = tutorialSteps[tutorialStep]?.tab;
    if (targetTab && targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [activeTab, isTutorialOpen, tutorialStep, tutorialSteps]);

  useEffect(() => {
    if (!isTutorialOpen) return;

    const syncHighlight = () => {
      const selector = tutorialSteps[tutorialStep]?.selector;
      if (!selector) {
        setTutorialRect(null);
        return;
      }
      const el = document.querySelector(selector);
      if (!el) {
        setTutorialRect(null);
        return;
      }
      requestAnimationFrame(() => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        setTutorialRect(rect);
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTutorialOpen(false);
        return;
      }
      if (event.key === "ArrowRight") {
        setTutorialStep((step) => Math.min(tutorialSteps.length - 1, step + 1));
      }
      if (event.key === "ArrowLeft") {
        setTutorialStep((step) => Math.max(0, step - 1));
      }
    };

    syncHighlight();
    window.addEventListener("resize", syncHighlight);
    window.addEventListener("scroll", syncHighlight, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", syncHighlight);
      window.removeEventListener("scroll", syncHighlight, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTab, isTutorialOpen, tutorialStep, tutorialSteps]);

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

    const savedNotificationWatches = localStorage.getItem("cypress_notification_watches");
    if (savedNotificationWatches) {
      try { setNotificationWatches(JSON.parse(savedNotificationWatches)); } catch {}
    }
    const savedCourseHistory = localStorage.getItem("cypress_course_history");
    if (savedCourseHistory) {
      try { setCourseHistory(JSON.parse(savedCourseHistory)); } catch {}
    }

    setIsLoaded(true);
  }, []);

  // CLOUD STORAGE OVERRIDE LOAD
  useEffect(() => {
    if (session?.user?.email) {
      fetch('/api/schedules')
        .then((res) => res.json())
        .then((data) => {
          const guestSnapshotRaw = localStorage.getItem("cypress_guest_snapshot");
          const guestSnapshot = guestSnapshotRaw ? JSON.parse(guestSnapshotRaw) : null;

          if (Array.isArray(data) && data.length > 0) {
            let merged = data;
            let nextActiveId = data[0].id;

            if (guestSnapshot?.schedules?.length > 0) {
              const imported = guestSnapshot.schedules.map((sched: any, index: number) => ({
                ...sched,
                id: `${sched.id}-guest-${Date.now()}-${index}`,
                name: `${sched.name} (Imported)`,
              }));
              merged = [...data, ...imported];
              nextActiveId = imported[0].id;
              setLastSavedStateString(JSON.stringify({ schedules: [], activeId: "" }));
              localStorage.removeItem("cypress_guest_snapshot");
            } else {
              setLastSavedStateString(JSON.stringify({ schedules: data, activeId: data[0].id }));
            }

            setSchedules(merged);
            setActiveScheduleId(nextActiveId);
          } else if (guestSnapshot?.schedules?.length > 0) {
            setSchedules(guestSnapshot.schedules);
            setActiveScheduleId(guestSnapshot.activeId || guestSnapshot.schedules[0]?.id || "");
            setLastSavedStateString(JSON.stringify({ schedules: [], activeId: "" }));
            localStorage.removeItem("cypress_guest_snapshot");
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

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("cypress_notification_watches", JSON.stringify(notificationWatches));
  }, [notificationWatches, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem("cypress_course_history", JSON.stringify(courseHistory));
  }, [courseHistory, isLoaded]);

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

  // signIn() makes a couple of round trips before Google's screen even opens, and
  // the redirect back is slower still — without this the button looks frozen.
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleGoogleSignIn = () => {
    localStorage.setItem("cypress_guest_snapshot", JSON.stringify({ schedules, activeId: activeScheduleId }));
    setIsSigningIn(true);
    signIn('google', { callbackUrl: '/' }).catch(() => setIsSigningIn(false));
  };

  const handleSignOut = async () => {
    // Reset the live screen to a blank slate when leaving an authenticated session.
    const defaultId = Date.now().toString();
    const defaultSchedules = [{ id: defaultId, name: "Plan 1", courses: [] }];
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
                name: sched.name,
                courses: sched.courses,
              }),
          })
        )
      );

      setLastSavedStateString(JSON.stringify({ schedules, activeId: activeScheduleId }));

      showToast("Saved", "Schedules securely saved to the cloud! ☁️");

    } catch (error) {
      console.error("Failed to save to cloud:", error);
      alert("Something went wrong saving to the cloud. Please try again.");
    }
  };

  const isCourseNotificationEnabled = useCallback((crn: string) => {
    const watch = notificationWatches[crn];
    if (!watch) return false;
    return Object.values(watch.flags).some(Boolean);
  }, [notificationWatches]);

  const openNotificationModalForCourse = (course: any) => {
    const eligibility = getNotificationEligibility(course.term || termQuery);
    if (!eligibility.allowed) {
      showToast("Notifications unavailable", eligibility.reason || "Notifications are unavailable for this course term.");
      return;
    }
    setNotificationModalCourse(course);
  };

  const getNotificationFlags = useCallback((crn: string): NotificationFlags => {
    return notificationWatches[crn]?.flags || {
      open: false,
      waitlist: false,
      full: false,
      restrictions: false,
    };
  }, [notificationWatches]);

  const toggleNotificationFlag = (course: any, key: keyof NotificationFlags) => {
    const current = getNotificationFlags(course.crn);
    const nextFlags = { ...current, [key]: !current[key] };
    handleUpdateNotificationWatch(course, nextFlags);
  };

  const handleUpdateNotificationWatch = (course: any, flags: NotificationFlags) => {
    const userEmail = session?.user?.email;
    if (!userEmail) {
      setIsSignInModalOpen(true);
      return;
    }
    const watch: NotificationWatch = {
      crn: course.crn,
      term: course.term || termQuery,
      title: `${course.subject || ""} ${course.courseNumber || ""}`.trim() || course.title || course.crn,
      email: userEmail,
      flags,
      lastStatus: getCourseAvailabilityStatus(course),
      lastRestrictionSignature: getRestrictionSignature(course),
    };
    setNotificationWatches((prev) => ({ ...prev, [course.crn]: watch }));
  };

  const removeNotificationWatch = useCallback((crn: string) => {
    setNotificationWatches((prev) => {
      const next = { ...prev };
      delete next[crn];
      return next;
    });
  }, []);

  const clearAllNotificationWatches = useCallback(() => {
    setNotificationWatches({});
  }, []);

  const activeNotificationWatches = useMemo(
    () => Object.values(notificationWatches).filter((w) => Object.values(w.flags).some(Boolean)),
    [notificationWatches]
  );
  const hasActiveNotificationWatches = activeNotificationWatches.length > 0;

  useEffect(() => {
    const hasAnyWatch = Object.values(notificationWatches).some((watch) => Object.values(watch.flags).some(Boolean));
    if (!session?.user?.email || !hasAnyWatch) return;

    const poll = async () => {
      for (const watch of Object.values(notificationWatches)) {
        if (!Object.values(watch.flags).some(Boolean)) continue;
        try {
          const res = await fetch(`/api/courses?q=${encodeURIComponent(watch.crn)}&term=${encodeURIComponent(watch.term)}`);
          const data = await res.json();
          const latest = Array.isArray(data) ? data.find((c: any) => c.crn === watch.crn) : null;
          if (!latest) continue;

          const latestStatus = getCourseAvailabilityStatus(latest);
          const latestRestrictionSignature = getRestrictionSignature(latest);
          const shouldSend =
            (watch.flags.open && watch.lastStatus !== "OPEN" && latestStatus === "OPEN") ||
            (watch.flags.waitlist && watch.lastStatus !== "WAITLIST" && latestStatus === "WAITLIST") ||
            (watch.flags.full && watch.lastStatus !== "FULL" && latestStatus === "FULL") ||
            (watch.flags.restrictions && watch.lastRestrictionSignature !== latestRestrictionSignature);

          if (shouldSend) {
            setCourseHistory((prev) => {
              const next: CourseHistoryEvent[] = [
                {
                  crn: watch.crn,
                  title: watch.title,
                  term: watch.term,
                  status: latestStatus,
                  at: new Date().toISOString(),
                },
                ...prev,
              ];
              return next.slice(0, COURSE_HISTORY_LIMIT);
            });
            await fetch("/api/notifications/email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                crn: watch.crn,
                title: watch.title,
                status: latestStatus,
                term: watch.term,
                restrictionsChanged: watch.lastRestrictionSignature !== latestRestrictionSignature,
              }),
            });
          }

          setNotificationWatches((prev) => {
            if (!prev[watch.crn]) {
              // Watch may have been removed while an async poll request was in flight.
              return prev;
            }
            return {
              ...prev,
              [watch.crn]: {
                ...prev[watch.crn],
                lastStatus: latestStatus,
                lastRestrictionSignature: latestRestrictionSignature,
              },
            };
          });
        } catch {
          // Silent retry on next poll.
        }
      }
    };

    poll();
    const interval = setInterval(poll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [notificationWatches, session?.user?.email]);

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

  // Whether any two scheduled events overlap on the same weekday (drives the toolbar pill).
  const hasScheduleConflict = useMemo(() => {
    const evs = myScheduleEvents;
    for (let i = 0; i < evs.length; i++) {
      for (let j = i + 1; j < evs.length; j++) {
        const a = evs[i];
        const b = evs[j];
        if (a.start.getDay() === b.start.getDay() && a.start < b.end && b.start < a.end) {
          return true;
        }
      }
    }
    return false;
  }, [myScheduleEvents]);

  const groupedSearchResults = useMemo(() => {
    const filteredResults = searchResults.filter((course) => {
      if (searchMode !== "manual") return true;
      if (manualFilters.subject && String(course.subject || "").toLowerCase() !== manualFilters.subject.toLowerCase()) return false;
      if (manualFilters.courseNumber && !String(course.courseNumber || "").toLowerCase().includes(manualFilters.courseNumber.toLowerCase())) return false;
      if (manualFilters.crn && !String(course.crn || "").includes(manualFilters.crn.trim())) return false;
      if (manualFilters.instructor) {
        const professors = Array.isArray(course.professors) ? course.professors.join(" ").toLowerCase() : "";
        if (!professors.includes(manualFilters.instructor.toLowerCase())) return false;
      }
      if (manualFilters.meetingDay !== "any") {
        const hasDay = Array.isArray(course.meetings) && course.meetings.some((meeting: any) => Array.isArray(meeting.days) && meeting.days.includes(manualFilters.meetingDay));
        if (!hasDay) return false;
      }
      if (manualFilters.instructionMode !== "any") {
        const mode = String(course.instructionMode || "").toLowerCase();
        if (manualFilters.instructionMode === "online" && !mode.includes("online")) return false;
        if (manualFilters.instructionMode === "hybrid" && !mode.includes("hyb")) return false;
        if (manualFilters.instructionMode === "in-person" && (mode.includes("online") || mode.includes("hyb"))) return false;
      }
      if (manualFilters.availability !== "any") {
        const status = getCourseAvailabilityStatus(course).toLowerCase();
        if (status !== manualFilters.availability) return false;
      }
      if (manualFilters.startAfterHour !== "any") {
        const requiredHour = Number(manualFilters.startAfterHour);
        const starts = Array.isArray(course.meetings)
          ? course.meetings
              .map((meeting: any) => meeting.startTime)
              .filter(Boolean)
              .map((time: string) => Number(time.split(":")[0]))
          : [];
        if (starts.length > 0 && starts.some((hour: number) => Number.isFinite(hour) && hour < requiredHour)) return false;
      }
      return true;
    });

    if (!Array.isArray(filteredResults)) return [];
    const groups = new Map<string, any>();
    filteredResults.forEach(course => {
      const key = `${course.subject} ${course.courseNumber}`;
      if (!groups.has(key)) {
        groups.set(key, { id: key, subject: course.subject, courseNumber: course.courseNumber, title: course.title, description: course.description, sections: [] });
      }
      groups.get(key).sections.push(course);
    });
    return Array.from(groups.values());
  }, [searchMode, searchResults, manualFilters]);

  const groupedAlternatives = useMemo(() => {
    const activeKeys = new Set(activeCourses.map((course) => getCourseGroupKey(course)));
    return groupedSearchResults.filter((group) => activeKeys.has(`${group.subject} ${group.courseNumber}`.trim()));
  }, [activeCourses, groupedSearchResults]);

  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    searchResults.forEach((course) => {
      if (course.subject) subjects.add(String(course.subject));
    });
    return Array.from(subjects).sort();
  }, [searchResults]);

  const optimizedScheduleOptions = useMemo<OptimizedScheduleOption[]>(() => {
    if (activeCourses.length === 0) return [];
    const pools = activeCourses.map((course) => {
      const groupKey = getCourseGroupKey(course);
      const alternatives = searchResults.filter((candidate) => getCourseGroupKey(candidate) === groupKey);
      const uniqueByCrn = new Map<string, any>();
      [course, ...alternatives].forEach((candidate) => uniqueByCrn.set(String(candidate.crn), candidate));
      return Array.from(uniqueByCrn.values());
    });

    const options: OptimizedScheduleOption[] = [];
    const maxCombinations = 1500;
    let combinationsVisited = 0;
    const build = (index: number, chosen: any[], chosenEvents: any[]) => {
      if (combinationsVisited > maxCombinations) return;
      if (index >= pools.length) {
        const dayLoad: Record<string, number> = {};
        let fridayClasses = 0;
        let earliestStartHour = 24;
        chosen.forEach((course) => {
          const days = getMeetingDays(course);
          const uniqueDays = new Set(days);
          uniqueDays.forEach((day) => {
            dayLoad[day] = (dayLoad[day] || 0) + 1;
            if (day === "F") fridayClasses += 1;
          });
          const startHour = getEarliestCourseStartHour(course);
          if (startHour !== null) {
            earliestStartHour = Math.min(earliestStartHour, startHour);
          }
        });

        const busiestDayLoad = Object.values(dayLoad).length > 0 ? Math.max(...Object.values(dayLoad)) : 0;
        const campusDays = Object.keys(dayLoad).filter((day) => day !== "Sa" && day !== "Su").length;
        const earliest = earliestStartHour === 24 ? 24 : earliestStartHour;
        const beforePreferred = Math.max(0, optimizerConstraints.earliestStartHour - earliest);
        const overDailyLimit = Math.max(0, busiestDayLoad - optimizerConstraints.maxClassesPerDay);
        const fridayPenalty = optimizerConstraints.avoidFridays ? fridayClasses * 15 : 0;
        const score = overDailyLimit * 12 + beforePreferred * 5 + fridayPenalty + campusDays;

        options.push({
          id: `option-${options.length + 1}`,
          courses: chosen,
          score,
          metrics: {
            fridayClasses,
            earliestStartHour: earliest,
            busiestDayLoad,
            campusDays,
          },
        });
        combinationsVisited += 1;
        return;
      }

      for (const candidate of pools[index]) {
        const candidateEvents = generateEventsFromMeetings(candidate);
        if (checkConflict(candidateEvents, chosenEvents)) continue;
        build(index + 1, [...chosen, candidate], [...chosenEvents, ...candidateEvents]);
      }
    };

    build(0, [], []);
    return options.sort((a, b) => a.score - b.score).slice(0, optimizerLimit);
  }, [activeCourses, optimizerConstraints, optimizerLimit, searchResults]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const runManualSearch = () => {
    const queryTokens = [
      manualFilters.subject,
      manualFilters.courseNumber,
      manualFilters.crn,
      manualFilters.instructor,
    ]
      .map((value) => value.trim())
      .filter(Boolean);
    const combinedQuery = queryTokens.join(" ");
    if (!combinedQuery) {
      showToast("Nothing to search", "Add at least one field (subject, course number, CRN, or instructor) to run manual search.");
      return;
    }
    setManualSearchHasRun(true);
    performSearch(combinedQuery, termQuery);
  };

  const resetManualSearch = () => {
    setManualFilters({
      subject: "",
      courseNumber: "",
      crn: "",
      instructor: "",
      meetingDay: "any",
      instructionMode: "any",
      availability: "any",
      startAfterHour: "any",
    });
    setManualSearchHasRun(false);
    setSearchResults([]);
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

  const handleCopyShareLink = async () => {
    if (!activeSchedule || !session?.user?.email) {
      showToast("Sign in required", "Sign in to create a secure share link.");
      return;
    }

    let url: string;
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: activeSchedule.name,
          courses: activeSchedule.courses,
        }),
      });

      const data = await res.json();
      if (!res.ok || (!data?.token && (!data?.payload || !data?.sig))) {
        throw new Error(data?.error || "Failed to create share link.");
      }

      url = data.token
        ? `${window.location.origin}/share/s/${encodeURIComponent(data.token)}`
        : `${window.location.origin}/share?payload=${encodeURIComponent(data.payload)}&sig=${encodeURIComponent(data.sig)}`;
    } catch (error) {
      console.error("Share link creation failed", error);
      showToast("Share failed", "Unable to create share link right now.");
      return;
    }

    // The link exists at this point — a clipboard failure must not read as
    // "couldn't create the link". Safari in particular rejects writeText once
    // the user gesture has been spent on an await, so always keep a fallback.
    const copied = await copyTextToClipboard(url);
    if (copied) {
      showToast("Link copied", "Short share link copied to clipboard.");
    } else {
      setShareFallbackUrl(url);
    }
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
      showToast(
        "Term mismatch",
        `This plan already has ${existingTerms.filter(Boolean).join(", ")} classes and ${course.subject} ${course.courseNumber} is ${course.term}. Save to cloud to keep both.`,
        5000,
      );
    }

    const getWalkWarning = () => {
      for (const event of myScheduleEvents) {
        if (!event.meetingInfo?.building) continue;
        for (const newEvent of newEvents) {
          if (!newEvent.meetingInfo?.building) continue;
          const sameDay = event.start.getDay() === newEvent.start.getDay();
          if (!sameDay) continue;

          const gapAfter = (newEvent.start.getTime() - event.end.getTime()) / 60000;
          const gapBefore = (event.start.getTime() - newEvent.end.getTime()) / 60000;
          const transitionGap = gapAfter >= 0 ? gapAfter : gapBefore >= 0 ? gapBefore : -1;
          if (transitionGap < 0 || transitionGap > 15) continue;

          const from = getBuildingCoordinates(event.meetingInfo.building);
          const to = getBuildingCoordinates(newEvent.meetingInfo.building);
          if (!from || !to) continue;

          const walkMinutes = estimateWalkingMinutes(from, to);
          if (walkMinutes > transitionGap) {
            return `Travel warning: ~${walkMinutes} min walk between ${event.meetingInfo.building} and ${newEvent.meetingInfo.building} with only ${Math.round(transitionGap)} min gap.`;
          }
        }
      }
      return null;
    };

    const walkWarning = getWalkWarning();
    if (walkWarning) {
      showToast("Tight walk between classes", walkWarning, 6000);
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

  const applyOptimizedOption = (option: OptimizedScheduleOption) => {
    if (!activeScheduleId) return;
    saveStateToHistory();
    setSchedules((prev) =>
      prev.map((schedule) =>
        schedule.id === activeScheduleId ? { ...schedule, courses: option.courses } : schedule
      )
    );
    setOptimizerNotice(`Applied ${option.id.replace("option-", "Option ")} to ${activeSchedule?.name || "current plan"}.`);
  };

  const performSearch = useCallback(async (query: string, term: string) => {
    if (!query.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/courses?q=${encodeURIComponent(query)}&term=${term}`);
      const data = await res.json();
      const sourceHeader = res.headers.get("x-course-source");
      const sourceReasonHeader = res.headers.get("x-course-source-reason");
      setLastSearchSource(sourceHeader === "fallback" ? "fallback" : "db");
      setLastSearchSourceReason(sourceReasonHeader);
      setLastSearchAt(new Date().toISOString());
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

  const handleImportFromMyGateway = async () => {
    const parsed = parseMyGatewayRegistrations(importText);
    if (parsed.length === 0) {
      alert("No valid registration rows found. Please paste from the first class title through each CRN block.");
      return;
    }

    setIsImporting(true);
    try {
      const uniqueCrns = Array.from(new Set(parsed.map((item) => item.crn)));
      const foundCourses: any[] = [];
      const missingCrns: string[] = [];

      for (const crn of uniqueCrns) {
        const registration = parsed.find((p) => p.crn === crn);
        const preferredTerm = registration?.term || termQuery;
        const res = await fetch(`/api/courses?q=${encodeURIComponent(crn)}&term=${encodeURIComponent(preferredTerm)}`);
        const data = await res.json();
        const match = Array.isArray(data) ? data.find((course: any) => String(course.crn) === crn) : null;
        if (match) foundCourses.push(match);
        else missingCrns.push(crn);
      }

      if (foundCourses.length > 0) {
        saveStateToHistory();
        setSchedules((prev) =>
          prev.map((schedule) => {
            if (schedule.id !== activeScheduleId) return schedule;
            const existing = new Set(schedule.courses.map((course: any) => String(course.crn)));
            const additions = foundCourses.filter((course) => !existing.has(String(course.crn)));
            return { ...schedule, courses: [...schedule.courses, ...additions] };
          }),
        );
      }

      const importedCount = foundCourses.length;
      const missingCount = missingCrns.length;
      showToast(
        missingCount > 0 ? "Imported with gaps" : "Import complete",
        missingCount > 0
          ? `Imported ${importedCount} class(es). ${missingCount} CRN(s) were not found in this term/data source.`
          : `Imported ${importedCount} class(es) from pasted registration data.`,
        6000,
      );
      setIsImportModalOpen(false);
      setImportText("");
    } finally {
      setIsImporting(false);
    }
  };

  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || isChatLoading) return;

    const nextMessages: ChatMessage[] = [...chatMessages, { role: "user", content: text }];
    setChatMessages(nextMessages);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      const reply =
        typeof data?.reply === "string" && data.reply.trim().length > 0
          ? data.reply
          : "I couldn't generate a response just now. Please try again.";
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm having trouble connecting right now. You can still search classes and build schedules while I reconnect.",
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, chatMessages, isChatLoading]);

  useEffect(() => {
    if (searchMode !== "quick") return;
    const delayDebounceFn = setTimeout(() => performSearch(searchQuery, termQuery), 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchMode, searchQuery, termQuery, performSearch]);

  useEffect(() => {
    if (searchMode === "quick") {
      setManualSearchHasRun(false);
    }
  }, [searchMode]);

  const exportCalendarAsImage = async () => {
    if (!calendarRef.current) return;
    try {
      const root = window.document.documentElement;
      const wasDark = root.classList.contains('dark');
      if (wasDark) root.classList.remove('dark');
      // Pulled in on demand — html-to-image is only ever needed by this button,
      // and eagerly importing it taxed every page load, sign-in redirect included.
      const { toPng } = await import("html-to-image");
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

    const icsContent = buildIcsCalendar(myScheduleEvents);
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeSchedule?.name.replace(/\s+/g, '-')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      <div className="flex flex-col w-full h-full overflow-hidden text-white cursor-pointer">
        <div className="font-bold text-[12px] leading-[1.15] whitespace-nowrap truncate pointer-events-none">
          {event.title}
        </div>
        <div className="text-[10.5px] leading-[1.2] whitespace-nowrap opacity-[0.85] pointer-events-none mt-[2px]">
          {startTime} – {endTime}
        </div>
        {!isCustom && (
          <div className="flex justify-between gap-1 text-[10.5px] leading-[1.2] opacity-[0.85] pointer-events-none">
            <span className="truncate">{location}</span>
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

  const tutorialCardPosition = (() => {
    if (!tutorialRect || typeof window === "undefined") return { top: 120, left: 40 };
    const cardWidth = Math.min(380, window.innerWidth - 20);
    const spaceBelow = window.innerHeight - tutorialRect.bottom;
    const placeBelow = spaceBelow > 190;
    const top = placeBelow
      ? Math.min(window.innerHeight - 190, tutorialRect.bottom + 10)
      : Math.max(10, tutorialRect.top - 165);
    const left = Math.min(
      Math.max(10, tutorialRect.left + tutorialRect.width / 2 - cardWidth / 2),
      window.innerWidth - cardWidth - 10
    );
    return { top, left, width: cardWidth };
  })();

  if (!isLoaded) return null;

  // Redirecting an un-authenticated, non-guest visitor to /welcome — render nothing
  // meanwhile so the scheduler never flashes. (Only runs client-side, after isLoaded.)
  if (
    status === "unauthenticated" &&
    typeof window !== "undefined" &&
    localStorage.getItem("cyp_guest") !== "1"
  ) {
    return null;
  }


  return (
    <div className="flex flex-col h-screen bg-[var(--cy-bg)] font-sans relative overflow-hidden transition-colors duration-300">
      
      {/* Calendar (.rbc-*) styling now lives in app/globals.css. Only app-specific
          extras remain here: hide the all-day row and tint the plan watermark. */}
      <style dangerouslySetInnerHTML={{__html: `
        .rbc-allday-cell { display: none !important; }
        .watermark-text { color: var(--cy-grid) !important; }
      `}} />

      <nav className="h-16 bg-charger-blue text-white flex items-center justify-between px-4 sm:px-6 shadow-lg border-b border-white/10 z-30 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-charger-gold shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0b2c5e" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>
          </span>
          <h1 className="font-serif text-[21px] font-normal tracking-tight whitespace-nowrap">Cypress Scheduler</h1>
          <div className="hidden sm:block w-px h-[22px] bg-white/20 shrink-0"></div>
          <div className="relative hidden sm:block">
            <button data-tour="schedule-dropdown" onClick={() => setIsDropdownOpen(!isDropdownOpen)} title="Switch active schedule plan" className="flex items-center gap-2 bg-white/10 hover:bg-white/[0.18] border border-white/[0.16] text-white text-[12.5px] font-semibold py-1.5 px-[11px] rounded-[9px] transition-colors cursor-pointer">
              <span className="w-[7px] h-[7px] rounded-full bg-charger-gold shrink-0"></span>
              <span className="truncate max-w-[150px]">{activeSchedule?.name || "Loading..."}</span>
              <svg className="h-3 w-3 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {isDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-[var(--cy-surface)] rounded-xl shadow-2xl border border-[var(--cy-border)] overflow-hidden z-[60]">
                <div className="max-h-60 overflow-y-auto">
                  {schedules.map((schedule) => (
                    <div key={schedule.id} className={`flex items-center justify-between p-3 border-b border-[var(--cy-border)] hover:bg-[var(--cy-surface-2)] cursor-pointer ${activeScheduleId === schedule.id ? 'bg-[var(--cy-surface-2)] border-l-4 border-l-[var(--cy-gold)]' : 'border-l-4 border-l-transparent'}`} onClick={() => { setActiveScheduleId(schedule.id); setIsDropdownOpen(false); }}>
                      <span className="font-bold text-[var(--cy-text)] text-sm flex-1 truncate pr-2">{schedule.name}</span>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); handleRenameSchedule(schedule.id, schedule.name); }} title="Rename schedule" className="text-[var(--cy-text-3)] hover:text-[var(--cy-gold)] p-1 cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(schedule.id); }} title="Delete schedule" className="text-[var(--cy-text-3)] hover:text-red-600 p-1 cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={handleCreateNewSchedule} title="Create a new schedule plan" className="w-full p-4 text-sm font-bold text-[var(--cy-gold)] hover:bg-[var(--cy-surface-2)] flex items-center justify-center gap-2 cursor-pointer">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>Add New Schedule
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4 relative">
          
          <button
            onClick={handleSaveSchedule}
            disabled={!session || !hasUnsavedChanges}
            title={!session ? "Sign in to save schedules to your account" : "Save schedules"}
            className={`flex items-center gap-2 text-sm font-bold py-1.5 px-3 rounded border transition-all cursor-pointer disabled:cursor-not-allowed ${session && hasUnsavedChanges ? "border-transparent bg-charger-gold hover:bg-charger-gold-hover text-charger-gold-ink shadow-sm" : "border-transparent bg-transparent text-white/50"}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
            <span className="hidden sm:inline">{session ? "SAVE" : "SIGN IN TO SAVE"}</span>
          </button>
          <button
            onClick={() => setIsImportModalOpen(true)}
            title="Import classes from pasted myGateway registration text"
            className="flex items-center gap-2 text-sm font-bold py-1.5 px-3 rounded border border-white/40 bg-white/15 hover:bg-white/25 text-white transition-all cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 12l-3-3m3 3l3-3M4 20h16" /></svg>
            <span className="hidden sm:inline">IMPORT</span>
          </button>
          <button
            onClick={handleCopyShareLink}
            title="Copy a read-only share link"
            className="hidden sm:flex items-center gap-2 text-sm font-bold py-1.5 px-3 rounded border border-white/40 bg-white/15 hover:bg-white/25 text-white transition-all cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
            <span>SHARE</span>
          </button>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle light / dark theme"
            aria-label="Toggle theme"
            className="w-8 h-8 flex items-center justify-center rounded bg-white/10 border border-white/[0.16] hover:bg-white/20 text-white transition-colors cursor-pointer shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
          </button>

          {/* UNIFIED SETTINGS / USER MENU CONTAINER */}
          <div className="relative flex items-center justify-center gap-2" ref={settingsMenuRef}>
            
            {!session ? (
              <button onClick={() => setIsSignInModalOpen(true)} title="Sign in with Google" aria-label="Sign in with Google" className="flex items-center gap-2 text-sm font-bold py-1.5 px-3 rounded transition-colors hover:bg-white/20 cursor-pointer">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" /></svg>
                <span className="hidden sm:inline tracking-wider">SIGN IN</span>
              </button>
            ) : (
              <button onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)} aria-label="Open profile settings" className="flex items-center justify-center w-8 h-8 bg-white/20 rounded-full font-bold text-sm transition-colors hover:bg-white/30 cursor-pointer shadow-sm" title="Profile Settings">
                {session.user?.name?.charAt(0).toUpperCase() || "U"}
              </button>
            )}

            <button data-tour="settings-button" onClick={() => setIsSettingsMenuOpen(!isSettingsMenuOpen)} title="Open settings menu" aria-label="Open settings menu" className="peer p-1.5 hover:bg-white/20 rounded transition-colors cursor-pointer">
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
                      <span className="text-[var(--cy-text-3)] text-sm truncate">{session.user?.email || "user@example.com"}</span>
                    </div>
                  </div>
                )}

                <h3 className="text-lg font-bold mb-3">Theme</h3>
                <div className="flex rounded-md overflow-hidden border border-gray-600 mb-6 bg-[#2d2d2d]">
                  <button onClick={() => setTheme('light')} className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer ${theme === 'light' ? 'bg-[#0b2c5e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>☀️ Light</button>
                  <button onClick={() => setTheme('system')} className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-1.5 border-l border-r border-gray-600 cursor-pointer ${theme === 'system' ? 'bg-[#0b2c5e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>⚙️ System</button>
                  <button onClick={() => setTheme('dark')} className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer ${theme === 'dark' ? 'bg-[#0b2c5e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>🌙 Dark</button>
                </div>

                <h3 className="text-lg font-bold mb-3">Time</h3>
                <div className="flex rounded-md overflow-hidden border border-gray-600 mb-4 bg-[#2d2d2d]">
                  <button onClick={() => setIs24Hour(false)} className={`flex-1 py-2 text-sm font-bold transition-colors cursor-pointer ${!is24Hour ? 'bg-[#0b2c5e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>12 Hour</button>
                  <button onClick={() => setIs24Hour(true)} className={`flex-1 py-2 text-sm font-bold border-l border-gray-600 transition-colors cursor-pointer ${is24Hour ? 'bg-[#0b2c5e] text-white' : 'hover:bg-gray-700 text-gray-300'}`}>24 Hour</button>
                </div>

                <button
                  onClick={() => {
                    setTutorialStep(0);
                    setIsTutorialOpen(true);
                    setIsSettingsMenuOpen(false);
                  }}
                  className="w-full mb-2 flex items-center gap-3 px-3 py-2 rounded-md border border-blue-500/40 text-blue-200 hover:bg-blue-500/10 transition-colors cursor-pointer text-sm font-bold"
                  title="Start guided tutorial"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Start quick tutorial
                </button>

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

      {/* Mobile bottom tab bar — replaces the old floating "View Calendar" pill.
          Calendar / Search / Added / Map. Below `lg` only; hidden on desktop. */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 h-[66px] pb-2 bg-[var(--cy-surface)] border-t border-[var(--cy-border)] grid grid-cols-4">
        {([
          { key: "calendar", label: "Calendar", d: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
          { key: "search", label: "Search", d: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" },
          { key: "added", label: "Added", d: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
          { key: "map", label: "Map", d: "M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex flex-col items-center justify-center gap-1 text-[9.5px] font-bold cursor-pointer transition-colors ${activeTab === t.key ? "text-[var(--cy-gold)]" : "text-[var(--cy-text-3)]"}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-[19px] h-[19px]"><path strokeLinecap="round" strokeLinejoin="round" d={t.d} /></svg>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-1 overflow-hidden relative" style={{ '--sidebar-width': `${sidebarWidth}%` } as React.CSSProperties}>
        
        {/* CALENDAR AREA */}
        <div className={`w-full lg:w-[calc(100%-var(--sidebar-width))] p-4 lg:p-8 flex-col z-10 transition-colors duration-300 overflow-y-auto ${activeTab === "calendar" ? 'flex' : 'hidden'} lg:flex`}>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4 sm:gap-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h2 className="text-[19px] font-bold tracking-[-0.01em] text-[var(--cy-text)] truncate max-w-[200px]">{activeSchedule?.name || "My Plan"}</h2>
              <span className="text-[12px] font-semibold text-[var(--cy-text-2)] bg-[var(--cy-chip)] border border-[var(--cy-border)] px-[9px] py-1 rounded-[7px] whitespace-nowrap shrink-0">{activeCourses.length} {activeCourses.length === 1 ? 'class' : 'classes'} · {totalUnits} units</span>
              {activeCourses.length > 0 && (
                hasScheduleConflict ? (
                  <span className="hidden sm:flex items-center gap-1.5 text-[12px] font-bold text-[#B0413E] bg-[rgb(176_65_62/0.10)] border border-[rgb(176_65_62/0.25)] px-[9px] py-1 rounded-[7px] whitespace-nowrap shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                    Conflict
                  </span>
                ) : (
                  <span className="hidden sm:flex items-center gap-1.5 text-[12px] font-bold text-[#1F7A4D] bg-[rgb(31_122_77/0.10)] border border-[rgb(31_122_77/0.25)] px-[9px] py-1 rounded-[7px] whitespace-nowrap shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    No conflicts
                  </span>
                )
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap sm:flex-nowrap">
              <button onClick={undo} disabled={past.length === 0} title="Undo last schedule change" aria-label="Undo" className="p-2 rounded-[9px] bg-[var(--cy-surface)] border border-[var(--cy-border)] text-[var(--cy-text-2)] hover:border-[#B87A00] hover:text-[#B87A00] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-4 h-4" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg></button>
              <button onClick={redo} disabled={future.length === 0} title="Redo last undone change" aria-label="Redo" className="p-2 rounded-[9px] bg-[var(--cy-surface)] border border-[var(--cy-border)] text-[var(--cy-text-2)] hover:border-[#B87A00] hover:text-[#B87A00] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-4 h-4" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg></button>

              <div className="flex items-center bg-[var(--cy-chip)] border border-[var(--cy-border)] rounded-[9px] p-[2px]">
                <button onClick={() => setCalendarView("work_week")} className={`text-[12px] font-semibold px-[11px] py-[5px] rounded-[7px] whitespace-nowrap cursor-pointer transition-colors ${calendarView === "work_week" ? "bg-[var(--cy-surface)] text-[var(--cy-text)] shadow-[0_1px_2px_rgba(11,27,51,0.10)]" : "text-[var(--cy-text-3)] hover:text-[var(--cy-text-2)]"}`}>Mon–Fri</button>
                <button onClick={() => setCalendarView("week")} className={`text-[12px] font-semibold px-[11px] py-[5px] rounded-[7px] whitespace-nowrap cursor-pointer transition-colors ${calendarView === "week" ? "bg-[var(--cy-surface)] text-[var(--cy-text)] shadow-[0_1px_2px_rgba(11,27,51,0.10)]" : "text-[var(--cy-text-3)] hover:text-[var(--cy-text-2)]"}`}>7 days</button>
              </div>

              <button onClick={exportCalendarAsImage} title="Save calendar as PNG image" className="bg-[var(--cy-surface)] border border-[var(--cy-border)] text-[var(--cy-text-2)] rounded-[9px] px-[11px] py-[6px] text-[12px] font-semibold hover:border-[#B87A00] hover:text-[#B87A00] transition-colors cursor-pointer whitespace-nowrap">PNG</button>
              <button onClick={exportCalendarAsIcs} title="Download calendar as .ics file" className="bg-[var(--cy-surface)] border border-[var(--cy-border)] text-[var(--cy-text-2)] rounded-[9px] px-[11px] py-[6px] text-[12px] font-semibold hover:border-[#B87A00] hover:text-[#B87A00] transition-colors cursor-pointer whitespace-nowrap">.ics</button>
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
                title="Add a custom calendar event"
                className="bg-[var(--cy-surface)] border border-[var(--cy-border)] text-[var(--cy-text)] rounded-[9px] px-3 py-[6px] text-[12px] font-bold hover:border-[#B87A00] hover:text-[#B87A00] transition-colors cursor-pointer whitespace-nowrap"
              >
                + Event
              </button>
            </div>
          </div>

          <div ref={calendarRef} className="flex-1 min-h-[660px] bg-[var(--cy-surface)] rounded-[14px] shadow-[0_8px_24px_-12px_rgb(11_27_51/0.16)] pt-[14px] px-[14px] pb-[6px] border border-[var(--cy-border)] overflow-hidden relative mb-20 lg:mb-0">
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
                  color: "#fff",
                  border: "none",
                  borderLeft: "3px solid rgba(255,255,255,0.45)",
                  borderRadius: 8,
                  boxShadow: "0 2px 6px rgba(11,27,51,0.18)",
                  cursor: "pointer",
                },
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

        <div className={`w-full lg:w-[var(--sidebar-width)] p-0 pb-[66px] lg:pb-0 flex-col bg-[var(--cy-surface)] border-l border-[var(--cy-border)] z-20 transition-colors duration-300 ${activeTab === "calendar" ? 'hidden' : 'flex'} lg:flex`}>
          
          <div className="p-4 sm:p-6 pb-0 relative">
            <div className="flex w-full mb-6 overflow-x-auto border-b border-[var(--cy-border)]">
              <button data-tour="search-tab"
                onClick={() => setActiveTab("search")} 
                className={`flex-1 flex justify-center items-center gap-1.5 pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "search" ? "border-[var(--cy-gold)] text-[var(--cy-gold)]" : "border-transparent text-[var(--cy-text-3)] hover:text-gray-800 dark:hover:text-gray-200"}`}
                title="Open search panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
                Search
              </button>
              <button data-tour="added-tab"
                onClick={() => setActiveTab("added")} 
                className={`flex-1 flex justify-center items-center gap-1.5 pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "added" ? "border-[var(--cy-gold)] text-[var(--cy-gold)]" : "border-transparent text-[var(--cy-text-3)] hover:text-gray-800 dark:hover:text-gray-200"}`}
                title="Open added classes panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
                Added
              </button>
              <button data-tour="map-tab"
                onClick={() => setActiveTab("map")} 
                className={`flex-1 flex justify-center items-center gap-1.5 pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${activeTab === "map" ? "border-[var(--cy-gold)] text-[var(--cy-gold)]" : "border-transparent text-[var(--cy-text-3)] hover:text-gray-800 dark:hover:text-gray-200"}`}
                title="Open map panel"
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
                  <div className="grid grid-cols-2 border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setSearchMode("quick")}
                      className={`py-2.5 text-sm font-black tracking-wide cursor-pointer ${searchMode === "quick" ? "bg-charger-blue text-white" : "bg-[var(--cy-surface)] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                    >
                      Quick Search
                    </button>
                    <button
                      onClick={() => setSearchMode("manual")}
                      className={`py-2.5 text-sm font-black tracking-wide cursor-pointer ${searchMode === "manual" ? "bg-charger-blue text-white" : "bg-[var(--cy-surface)] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                    >
                      Manual Search
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <select data-tour="term-select" value={termQuery} onChange={(e) => setTermQuery(e.target.value)} title="Choose academic term" className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface-2)] dark:text-gray-100 font-medium focus:outline-none focus:ring-2 focus:ring-[#B87A00] cursor-pointer w-full sm:w-auto shrink-0 shadow-sm">
                      <option value="2026-Fall">Fall 2026</option>
                      <option value="2026-Summer">Summer 2026</option>
                      <option value="2026-Winter/Spring">Winter/Spring 2026</option>
                    </select>
                    {searchMode === "quick" ? (
                      <input data-tour="search-input" type="text" placeholder="Search by title, subject, or CRN..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} title="Search courses by title, subject, or CRN" className="flex-1 border border-[var(--cy-border)] rounded-xl px-4 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00] shadow-sm" />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1">
                        <select
                          value={manualFilters.subject}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, subject: e.target.value }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        >
                          <option value="">Department (Any)</option>
                          {availableSubjects.map((subject) => (
                            <option key={`subject-${subject}`} value={subject}>{subject}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Course Number (e.g. 101)"
                          value={manualFilters.courseNumber}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, courseNumber: e.target.value }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        />
                        <input
                          type="text"
                          placeholder="CRN / Section Code"
                          value={manualFilters.crn}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, crn: e.target.value }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        />
                        <input
                          type="text"
                          placeholder="Instructor name"
                          value={manualFilters.instructor}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, instructor: e.target.value }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        />
                        <select
                          value={manualFilters.meetingDay}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, meetingDay: e.target.value as ManualSearchFilters["meetingDay"] }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        >
                          <option value="any">Any day</option>
                          <option value="M">Monday</option>
                          <option value="Tu">Tuesday</option>
                          <option value="W">Wednesday</option>
                          <option value="Th">Thursday</option>
                          <option value="F">Friday</option>
                        </select>
                        <select
                          value={manualFilters.instructionMode}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, instructionMode: e.target.value as ManualSearchFilters["instructionMode"] }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        >
                          <option value="any">Any format</option>
                          <option value="in-person">In-person</option>
                          <option value="online">Online</option>
                          <option value="hybrid">Hybrid</option>
                        </select>
                        <select
                          value={manualFilters.availability}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, availability: e.target.value as ManualSearchFilters["availability"] }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        >
                          <option value="any">Any availability</option>
                          <option value="open">Open seats</option>
                          <option value="waitlist">Waitlist available</option>
                          <option value="full">Full</option>
                        </select>
                        <select
                          value={manualFilters.startAfterHour}
                          onChange={(e) => setManualFilters((prev) => ({ ...prev, startAfterHour: e.target.value as ManualSearchFilters["startAfterHour"] }))}
                          className="border border-[var(--cy-border)] rounded-xl px-3 py-2 text-sm bg-[var(--cy-surface)] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                        >
                          <option value="any">Any start time</option>
                          <option value="8">Start at/after 8:00</option>
                          <option value="9">Start at/after 9:00</option>
                          <option value="10">Start at/after 10:00</option>
                          <option value="11">Start at/after 11:00</option>
                          <option value="12">Start at/after 12:00</option>
                          <option value="13">Start at/after 1:00 PM</option>
                        </select>
                      </div>
                    )}
                  </div>
                  {searchMode === "manual" && (
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={resetManualSearch}
                        className="px-3 py-2 text-xs font-bold rounded-lg border border-[var(--cy-border)] text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                      >
                        Reset
                      </button>
                      <button
                        onClick={runManualSearch}
                        className="px-3 py-2 text-xs font-bold rounded-lg bg-charger-blue hover:bg-charger-blue-hover text-white cursor-pointer"
                      >
                        Search
                      </button>
                    </div>
                  )}
                  {(lastSearchSource || lastSearchAt) && (
                    <p className="text-[11px] text-[var(--cy-text-3)]">
                      Data source: <span className="font-bold">{lastSearchSource === "fallback" ? "Local fallback catalog" : "Database"}</span>
                      {lastSearchAt ? ` • Last refreshed ${new Date(lastSearchAt).toLocaleTimeString()}` : ""}
                      {lastSearchSource === "fallback" && lastSearchSourceReason === "db_error" ? " • Database unavailable right now." : ""}
                      {lastSearchSource === "fallback" && lastSearchSourceReason === "db_empty_after_search" ? " • No DB matches found for this query yet." : ""}
                    </p>
                  )}
                  <div className="flex items-center justify-end">
                    <div className="relative">
                    <button
                      onClick={() => setIsNotificationMenuOpen(!isNotificationMenuOpen)}
                      className={`w-10 h-10 rounded-full shadow-sm flex items-center justify-center border cursor-pointer transition-all hover:scale-105 active:scale-95 ${isNotificationMenuOpen ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300' : 'bg-[var(--cy-surface)] text-[var(--cy-text-2)] hover:bg-gray-100 dark:hover:bg-gray-700 border-[var(--cy-border)]'}`}
                      title="Notification menu"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill={hasActiveNotificationWatches ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 1 5.454 1.31A8.967 8.967 0 0 1 18 9.75V9a6 6 0 1 0-12 0v.75a8.967 8.967 0 0 1-2.312 6.642A23.848 23.848 0 0 1 9.143 17.082m5.714 0a24.255 24.255 0 0 0-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>
                    </button>
                    {isNotificationMenuOpen && (
                      <div className="absolute top-[120%] right-0 mt-2 w-72 max-w-[calc(100vw-3rem)] bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl border border-[var(--cy-border)] py-3 px-4 z-50">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-black text-gray-700 dark:text-gray-100">Notification Watches</h3>
                          {hasActiveNotificationWatches && (
                            <button
                              onClick={clearAllNotificationWatches}
                              className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                            >
                              Remove all
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-[var(--cy-text-3)] mt-1 mb-3">Bell icons on classes let you choose conditions.</p>
                        <div className="space-y-1 max-h-48 overflow-auto">
                          {!hasActiveNotificationWatches && (
                            <p className="text-xs text-[var(--cy-text-3)]">No watches enabled yet.</p>
                          )}
                          {activeNotificationWatches.map((watch) => (
                            <div key={watch.crn} className="text-xs border border-[var(--cy-border)] rounded-md px-2 py-1.5 text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate">
                                <span className="font-bold">{watch.title}</span> ({watch.crn})
                              </span>
                              <button
                                onClick={() => removeNotificationWatch(watch.crn)}
                                className="text-red-600 dark:text-red-400 hover:underline font-bold shrink-0 cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-3 border-t border-[var(--cy-border)]">
                          <h4 className="text-[11px] font-black uppercase tracking-wide text-[var(--cy-text-3)] mb-1.5">Recent status history</h4>
                          <div className="space-y-1 max-h-24 overflow-auto">
                            {courseHistory.length === 0 && (
                              <p className="text-xs text-[var(--cy-text-3)]">No changes recorded yet.</p>
                            )}
                            {courseHistory.slice(0, 5).map((event, index) => (
                              <p key={`${event.crn}-${event.at}-${index}`} className="text-xs text-gray-600 dark:text-gray-300">
                                <span className="font-bold">{event.title}</span> → {event.status}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  {isSearching && (
                    <div className="space-y-3 mt-2">
                      <p className="text-orange-500 dark:text-orange-400 text-sm font-bold text-center animate-pulse">Searching...</p>
                      {[0, 1, 2].map((i) => (
                        <div key={`skeleton-${i}`} className="border border-[var(--cy-border)] rounded-xl bg-[var(--cy-surface)] p-4 animate-pulse">
                          <div className="h-4 w-36 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
                          <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                          <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
                        </div>
                      ))}
                    </div>
                  )}
                  {groupedSearchResults.length === 0 && !isSearching && searchMode === "quick" && searchQuery.length > 0 && <p className="text-[var(--cy-text-3)] text-sm text-center mt-10">No classes found for "{searchQuery}".</p>}
                  {groupedSearchResults.length === 0 && !isSearching && searchMode === "quick" && searchQuery.length === 0 && <p className="text-[var(--cy-text-3)] dark:text-gray-500 text-sm text-center mt-10">Start typing to search for classes.</p>}
                  {groupedSearchResults.length === 0 && !isSearching && searchMode === "manual" && !manualSearchHasRun && <p className="text-[var(--cy-text-3)] dark:text-gray-500 text-sm text-center mt-10">Set manual filters, then click Search.</p>}
                  {groupedSearchResults.length === 0 && !isSearching && searchMode === "manual" && manualSearchHasRun && <p className="text-[var(--cy-text-3)] text-sm text-center mt-10">No manual matches. Try removing one or more filters.</p>}
                  {groupedSearchResults.map((group) => {
                    const isExpanded = expandedGroups[group.id];
                    return (
                      <div key={group.id} className="border border-[var(--cy-border)] rounded-xl shadow-sm bg-[var(--cy-surface)] overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
                        <div className="p-4 cursor-pointer hover:bg-[var(--cy-surface-2)] flex justify-between items-start sm:items-center transition-colors" onClick={() => toggleGroup(group.id)}>
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="flex items-center gap-2 mb-0.5">
                              <h2 className="font-extrabold text-[var(--cy-accent)] text-base sm:text-lg break-words">{group.subject} {group.courseNumber}</h2>
                              <button onClick={(e) => { e.stopPropagation(); setInfoModalCourse(group); }} className="p-1 rounded-full text-[var(--cy-text-3)] hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer" title="Course Information"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 pointer-events-none"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg></button>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 mt-1 sm:mt-0">
                            <span className="hidden sm:inline-block text-xs font-bold text-[var(--cy-gold)] bg-[rgb(184_122_0/0.12)] px-2.5 py-1 rounded-md border border-[rgb(184_122_0/0.30)] pointer-events-none whitespace-nowrap">{group.sections.length} {group.sections.length === 1 ? 'Section' : 'Sections'}</span>
                            <span className="sm:hidden text-xs font-bold text-[var(--cy-gold)] bg-[rgb(184_122_0/0.12)] px-2 py-1 rounded-md border border-[rgb(184_122_0/0.30)] pointer-events-none whitespace-nowrap">{group.sections.length}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-[var(--cy-text-3)] dark:text-gray-500 transition-transform duration-200 pointer-events-none ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="bg-[var(--cy-bg)]/50 p-2 sm:p-3 space-y-2 border-t border-[var(--cy-border)]">
                            {group.sections.map((section: any) => {
                              const isAdded = activeCourses.some((c) => c.crn === section.crn);
                              const instructionMode = String(section.instructionMode || "").toUpperCase();
                              let allTags: string[] = section.meetings?.map((m: any) => {
                                const hasDays = Array.isArray(m.days) && m.days.length > 0;
                                const hasTime = Boolean(m.startTime || m.endTime);
                                if (hasDays || hasTime) {
                                  const start = formatTimeDisplay(m.startTime, is24Hour);
                                  const end = formatTimeDisplay(m.endTime, is24Hour);
                                  const dayLabel = hasDays ? m.days.join("") : "TBA";
                                  return end ? `${dayLabel} ${start} - ${end}` : `${dayLabel} ${start}`;
                                }
                                if (m.building || m.room) {
                                  return `TBA ${[m.building, m.room].filter(Boolean).join(" ")}`.trim();
                                }
                                if (instructionMode.includes("HYB")) return "HYBRID";
                                return "ONLINE";
                              }) || [];
                              const hasNonRemoteTag = allTags.some((tag) => tag !== "ONLINE" && tag !== "HYBRID");
                              if (hasNonRemoteTag) {
                                allTags = allTags.filter((tag) => tag !== "ONLINE" && tag !== "HYBRID");
                              }
                              if (allTags.length === 0) allTags = [instructionMode.includes("HYB") ? "HYBRID" : "ONLINE"];
                              const uniqueTags: string[] = Array.from(new Set(allTags));
                              const profName = section.professors?.[0];
                              const rmpUrl = getRmpUrl(profName);

                              return (
                                <div key={section.crn} className="flex flex-col sm:flex-row justify-between items-start bg-[var(--cy-surface)] p-3 rounded-lg border border-[var(--cy-border)] shadow-sm gap-3 sm:gap-0">
                                  <div className="w-full sm:w-auto flex-1 min-w-0 pr-4">
                                    <div className="flex flex-wrap gap-1 mb-1.5 w-full">
                                      {uniqueTags.map((tag: string, i: number) => (
                                        <span key={i} className={`text-[10px] px-2 py-0.5 rounded font-bold border ${tag === 'ONLINE' ? 'bg-[var(--cy-chip)] border-[var(--cy-border)] text-[var(--cy-text-2)]' : 'bg-[var(--cy-chip)] border-[var(--cy-border)] text-[var(--cy-text-2)]'}`}>{tag}</span>
                                      ))}
                                      {rmpUrl ? (
                                        <a href={rmpUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-bold border border-[rgb(184_122_0/0.30)] bg-[rgb(184_122_0/0.12)] text-[var(--cy-gold)] hover:bg-[rgb(184_122_0/0.20)] transition-colors cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                          {profName}
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-75 pointer-events-none" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                                        </a>
                                      ) : profName && profName.toUpperCase() === "STAFF" ? (
                                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-[var(--cy-chip)] text-[var(--cy-text-3)] cursor-default">STAFF</span>
                                      ) : null}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                      <CourseStatusBadge course={section} />
                                      <p className="text-[10px] text-[var(--cy-text-3)] font-mono font-medium">CRN: {section.crn} • {(section.maxEnrollment || 0) - (section.seatsAvailable || 0)}/{section.maxEnrollment || 0} Enrolled</p>
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex items-center justify-end w-full sm:w-auto mt-2 sm:mt-0 gap-2">
                                    <button
                                      onClick={() => openNotificationModalForCourse(section)}
                                      className={`w-full sm:w-auto p-2 rounded-md border transition-colors cursor-pointer flex items-center justify-center ${isCourseNotificationEnabled(section.crn) ? 'bg-[rgb(232_163_23/0.14)] text-[var(--cy-gold)] border-[rgb(184_122_0/0.35)]' : 'bg-[var(--cy-surface)] text-[var(--cy-text-3)] border-[var(--cy-border)] hover:bg-[var(--cy-surface-2)]'}`}
                                      title="Notification settings"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" fill={isCourseNotificationEnabled(section.crn) ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 1 5.454 1.31A8.967 8.967 0 0 1 18 9.75V9a6 6 0 1 0-12 0v.75a8.967 8.967 0 0 1-2.312 6.642A23.848 23.848 0 0 1 9.143 17.082m5.714 0a24.255 24.255 0 0 0-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>
                                    </button>
                                    {isAdded ? (
                                      <button onClick={() => removeCourseFromSchedule(section)} className="w-full sm:w-auto bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 p-2 rounded-md transition-colors text-center cursor-pointer flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 pointer-events-none"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                      </button>
                                    ) : (
                                      <button onClick={() => addCourseToSchedule(section)} className="w-full sm:w-auto bg-charger-gold hover:bg-charger-gold-hover text-charger-gold-ink text-xl font-black py-1 px-4 rounded-md transition-colors shadow-sm text-center cursor-pointer flex items-center justify-center">+</button>
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
                <div className="sticky top-0 z-40 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-xl py-3 border-b border-[var(--cy-border)] -mx-4 px-4 sm:-mx-6 sm:px-6 mb-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    
                    {/* Copy Button */}
                    <div className="relative group">
                      <button onClick={handleCopySchedule} title="Duplicate current schedule" aria-label="Duplicate current schedule" className="w-10 h-10 rounded-full bg-[var(--cy-surface)] shadow-sm flex items-center justify-center text-[var(--cy-text-2)] hover:bg-gray-100 dark:hover:bg-gray-700 border border-[var(--cy-border)] cursor-pointer transition-transform hover:scale-105 active:scale-95">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>
                      </button>
                      <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Copy Schedule<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>

                    {/* Share Link Button */}
                    <div className="relative group">
                      <button data-tour="share-button" onClick={handleCopyShareLink} title="Copy short share link" className="w-10 h-10 rounded-full bg-[var(--cy-surface)] shadow-sm flex items-center justify-center text-[var(--cy-text-2)] hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300 border border-[var(--cy-border)] cursor-pointer transition-transform hover:scale-105 active:scale-95" aria-label="Copy share link">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-4.5-4.5h6m0 0v6m0-6L10.5 15" /></svg>
                      </button>
                      <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Copy Share Link<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>

                    {/* Clear/Trash Button */}
                    <div className="relative group">
                      <button onClick={clearActiveSchedule} title="Clear all classes in this schedule" aria-label="Clear schedule" className="w-10 h-10 rounded-full bg-[var(--cy-surface)] shadow-sm flex items-center justify-center text-[var(--cy-text-2)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 border border-[var(--cy-border)] cursor-pointer transition-all hover:scale-105 active:scale-95">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                      <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Clear Schedule<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>

                    {/* Column Visibility Toggle */}
                    <div className="relative group">
                      <button onClick={() => setIsColumnDropdownOpen(!isColumnDropdownOpen)} title="Show or hide course details columns" aria-label="Toggle visible columns" className={`w-10 h-10 rounded-full shadow-sm flex items-center justify-center border cursor-pointer transition-all hover:scale-105 active:scale-95 ${isColumnDropdownOpen ? 'bg-orange-100 text-orange-600 border-orange-300 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-400' : 'bg-[var(--cy-surface)] text-[var(--cy-text-2)] hover:bg-gray-100 dark:hover:bg-gray-700 border-[var(--cy-border)]'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                      </button>
                      
                      {!isColumnDropdownOpen && (
                        <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Show/Hide Info<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                      )}

                      {/* Dropdown Menu */}
                      {isColumnDropdownOpen && (
                        <div className="absolute top-[120%] left-0 mt-2 w-48 bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl border border-[var(--cy-border)] py-2 z-50 overflow-hidden">
                          <div className="px-4 py-1.5 text-[10px] font-black text-[var(--cy-text-3)] uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 mb-1 bg-[var(--cy-bg)]/50">Visible Info</div>
                          {Object.entries(visibleColumns).map(([key, isVisible]) => (
                            <label key={key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50 dark:hover:bg-gray-700 cursor-pointer transition-colors">
                              <input 
                                type="checkbox" 
                                checked={isVisible} 
                                onChange={() => setVisibleColumns(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))} 
                                className="w-4 h-4 rounded text-orange-600 focus:ring-[#B87A00] cursor-pointer border-[var(--cy-border)] dark:bg-gray-800" 
                              />
                              <span className="text-sm font-bold text-gray-700 dark:text-gray-200 capitalize select-none">{key}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Notification Menu Toggle */}
                    <div className="relative group">
                      <button data-tour="notification-button" onClick={() => setIsNotificationMenuOpen(!isNotificationMenuOpen)} title="Open notification watches" aria-label="Open notification watches" className={`w-10 h-10 rounded-full shadow-sm flex items-center justify-center border cursor-pointer transition-all hover:scale-105 active:scale-95 ${isNotificationMenuOpen ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300' : 'bg-[var(--cy-surface)] text-[var(--cy-text-2)] hover:bg-gray-100 dark:hover:bg-gray-700 border-[var(--cy-border)]'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill={hasActiveNotificationWatches ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 1 5.454 1.31A8.967 8.967 0 0 1 18 9.75V9a6 6 0 1 0-12 0v.75a8.967 8.967 0 0 1-2.312 6.642A23.848 23.848 0 0 1 9.143 17.082m5.714 0a24.255 24.255 0 0 0-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg>
                      </button>
                      {!isNotificationMenuOpen && (
                        <div className="absolute top-[110%] left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Notifications<div className="absolute bottom-full left-1/2 transform -translate-x-1/2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                      )}
                      {isNotificationMenuOpen && (
                        <div className="fixed inset-0 z-[70]" onClick={() => setIsNotificationMenuOpen(false)}>
                          <div className="absolute inset-0 bg-black/20" />
                          <div className="absolute top-28 left-1/2 -translate-x-1/2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl border border-[var(--cy-border)] py-3 px-4" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="text-sm font-black text-gray-700 dark:text-gray-100">Notification Watches</h3>
                              {hasActiveNotificationWatches && (
                                <button
                                  onClick={clearAllNotificationWatches}
                                  className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                                >
                                  Remove all
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-[var(--cy-text-3)] mt-1 mb-3">Bell icons on classes let you choose conditions.</p>
                            <div className="space-y-1 max-h-48 overflow-auto">
                              {!hasActiveNotificationWatches && (
                                <p className="text-xs text-[var(--cy-text-3)]">No watches enabled yet.</p>
                              )}
                              {activeNotificationWatches.map((watch) => (
                                <div key={watch.crn} className="text-xs border border-[var(--cy-border)] rounded-md px-2 py-1.5 text-gray-700 dark:text-gray-200 flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate">
                                    <span className="font-bold">{watch.title}</span> ({watch.crn})
                                  </span>
                                  <button
                                    onClick={() => removeNotificationWatch(watch.crn)}
                                    className="text-red-600 dark:text-red-400 hover:underline font-bold shrink-0 cursor-pointer"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 pt-3 border-t border-[var(--cy-border)]">
                              <h4 className="text-[11px] font-black uppercase tracking-wide text-[var(--cy-text-3)] mb-1.5">Recent status history</h4>
                              <div className="space-y-1 max-h-24 overflow-auto">
                                {courseHistory.length === 0 && (
                                  <p className="text-xs text-[var(--cy-text-3)]">No changes recorded yet.</p>
                                )}
                                {courseHistory.slice(0, 5).map((event, index) => (
                                  <p key={`${event.crn}-${event.at}-${index}`} className="text-xs text-gray-600 dark:text-gray-300">
                                    <span className="font-bold">{event.title}</span> → {event.status}
                                  </p>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Plan Name & Units */}
                  <div>
                    <h2 className="text-lg sm:text-xl font-black text-gray-800 dark:text-gray-200 tracking-tight">
                      {activeSchedule?.name || "My Plan"} <span className="text-[var(--cy-text-3)] font-bold text-base">({totalUnits} Units)</span>
                    </h2>
                  </div>
                </div>

                <div className="mb-5 rounded-xl border border-[rgb(184_122_0/0.35)] bg-[rgb(232_163_23/0.08)] p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-black text-[var(--cy-gold)]">Schedule Optimizer (Beta)</h3>
                    <span className="text-[11px] text-[#B87A00] font-semibold">
                      {groupedAlternatives.length} course{groupedAlternatives.length === 1 ? "" : "s"} with alternatives in current search
                    </span>
                  </div>
                  <p className="text-xs text-[var(--cy-text-2)] mt-1">
                    Search for each course first, then generate conflict-free options ranked by your preferences.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                    <label className="text-xs font-semibold text-[var(--cy-text-2)] flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={optimizerConstraints.avoidFridays}
                        onChange={(e) => setOptimizerConstraints((prev) => ({ ...prev, avoidFridays: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      Avoid Friday classes
                    </label>
                    <label className="text-xs font-semibold text-[var(--cy-text-2)] flex items-center gap-2">
                      Earliest start
                      <select
                        value={optimizerConstraints.earliestStartHour}
                        onChange={(e) => setOptimizerConstraints((prev) => ({ ...prev, earliestStartHour: Number(e.target.value) }))}
                        className="rounded border border-[var(--cy-border)] bg-[var(--cy-surface)] px-2 py-1 text-xs"
                      >
                        {[8, 9, 10, 11, 12].map((hour) => (
                          <option key={`start-${hour}`} value={hour}>{hour}:00</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-[var(--cy-text-2)] flex items-center gap-2">
                      Max classes/day
                      <select
                        value={optimizerConstraints.maxClassesPerDay}
                        onChange={(e) => setOptimizerConstraints((prev) => ({ ...prev, maxClassesPerDay: Number(e.target.value) }))}
                        className="rounded border border-[var(--cy-border)] bg-[var(--cy-surface)] px-2 py-1 text-xs"
                      >
                        {[2, 3, 4, 5].map((limit) => (
                          <option key={`daily-limit-${limit}`} value={limit}>{limit}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-[var(--cy-text-2)] flex items-center gap-2">
                      Number of options
                      <select
                        value={optimizerLimit}
                        onChange={(e) => setOptimizerLimit(Number(e.target.value))}
                        className="rounded border border-[var(--cy-border)] bg-[var(--cy-surface)] px-2 py-1 text-xs"
                      >
                        {[3, 5, 8].map((limit) => (
                          <option key={`option-limit-${limit}`} value={limit}>Top {limit}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {optimizerNotice && <p className="text-xs text-green-700 dark:text-green-400 mt-2">{optimizerNotice}</p>}
                  <div className="mt-3 space-y-2">
                    {optimizedScheduleOptions.length === 0 ? (
                      <p className="text-xs text-[var(--cy-text-2)]">
                        No valid options found. Try searching more sections or loosening constraints.
                      </p>
                    ) : (
                      optimizedScheduleOptions.map((option) => (
                        <div key={option.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--cy-border)] bg-[var(--cy-surface)] px-2.5 py-2">
                          <p className="text-xs text-[var(--cy-text)]">
                            <span className="font-black mr-1">{option.id.replace("option-", "Option ")}</span>
                            {option.metrics.fridayClasses} Fri · {option.metrics.busiestDayLoad} max/day · {option.metrics.earliestStartHour === 24 ? "TBA" : `${option.metrics.earliestStartHour}:00`} earliest
                          </p>
                          <button
                            onClick={() => applyOptimizedOption(option)}
                            className="text-xs font-bold px-2 py-1 rounded bg-charger-blue hover:bg-charger-blue-hover text-white cursor-pointer"
                          >
                            Apply
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {activeCourses.length === 0 ? (
                  <p className="text-[var(--cy-text-3)] dark:text-gray-500 text-sm text-center mt-10">This schedule is empty.</p>
                ) : (
                  activeCourses.map((course) => {
                    const notificationEligibility = getNotificationEligibility(course.term || termQuery);
                    return (
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
                        onToggleNotification={openNotificationModalForCourse}
                        isNotificationEnabled={isCourseNotificationEnabled(course.crn)}
                        isNotificationDisabled={!notificationEligibility.allowed}
                        notificationDisabledReason={notificationEligibility.reason}
                      />
                    );
                  })
                )}
              </div>
            )}

            {activeTab === "map" && (
              <div className="flex-1 w-full flex flex-col min-h-[70vh] rounded-xl border border-[var(--cy-border)] overflow-hidden relative z-0 shadow-sm">
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
      {isTutorialOpen && (
        <div className="fixed inset-0 z-[95]" role="dialog" aria-modal="true" aria-label="Scheduler tutorial">
          <div className="absolute inset-0 bg-black/35" onClick={() => setIsTutorialOpen(false)} />
          {tutorialRect && (
            <div
              className="absolute rounded-xl ring-4 ring-blue-500/80 pointer-events-none transition-all duration-300"
              style={{
                top: tutorialRect.top - 6,
                left: tutorialRect.left - 6,
                width: tutorialRect.width + 12,
                height: tutorialRect.height + 12,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.24)",
              }}
            />
          )}
          <div
            className="absolute bg-[#f2f3f5] text-gray-900 rounded-xl shadow-2xl border border-gray-300 p-4 sm:p-5"
            style={tutorialCardPosition}
          >
            <button
              onClick={() => setIsTutorialOpen(false)}
              className="absolute top-3 right-3 text-gray-700 hover:text-black cursor-pointer"
              aria-label="Close tutorial"
              title="Close tutorial"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <p className="text-[10px] uppercase tracking-[0.16em] font-black text-blue-700 mb-1">Site tour</p>
            <h3 className="text-2xl font-black mb-2">{tutorialSteps[tutorialStep]?.title}</h3>
            <p className="text-base leading-relaxed mb-4">{tutorialSteps[tutorialStep]?.body}</p>

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setTutorialStep((step) => Math.max(0, step - 1))}
                disabled={tutorialStep === 0}
                className="text-3xl font-black text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:text-gray-900"
                aria-label="Previous tutorial step"
              >
                ←
              </button>

              <div className="flex items-center gap-2">
                {tutorialSteps.map((_, index) => (
                  <button
                    key={`dot-${index}`}
                    onClick={() => setTutorialStep(index)}
                    className={`w-3 h-3 rounded-full border transition-colors ${index === tutorialStep ? "bg-charger-blue border-charger-blue" : "bg-transparent border-gray-400 hover:border-gray-600"}`}
                    title={`Go to step ${index + 1}`}
                    aria-label={`Go to tutorial step ${index + 1}`}
                  />
                ))}
              </div>

              {tutorialStep < tutorialSteps.length - 1 ? (
                <button
                  onClick={() => setTutorialStep((step) => Math.min(tutorialSteps.length - 1, step + 1))}
                  className="text-3xl font-black text-gray-600 hover:text-gray-900 cursor-pointer"
                  aria-label="Next tutorial step"
                >
                  →
                </button>
              ) : (
                <button
                  onClick={() => setIsTutorialOpen(false)}
                  className="px-4 py-2 rounded-md bg-charger-blue hover:bg-charger-blue-hover text-white font-bold cursor-pointer"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {notificationModalCourse && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4" role="dialog" aria-modal="true" aria-label="Notification settings" onClick={() => setNotificationModalCourse(null)}>
          <div className="bg-[#2d2d2d] rounded-xl shadow-2xl p-6 max-w-md w-full border border-gray-600 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-2xl font-bold">Notify When</h3>
              <div className="group relative">
                <button className="w-8 h-8 rounded-full border border-gray-300/70 text-gray-200 flex items-center justify-center font-bold cursor-help">?</button>
                <div className="absolute right-0 top-[120%] w-64 bg-black text-white text-xs rounded-lg p-3 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Email notifications will be sent to: <span className="font-bold">{session?.user?.email || "Sign in required"}</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { key: "open", label: "Section becomes OPEN" },
                { key: "waitlist", label: "Section becomes WAITLIST" },
                { key: "full", label: "Section becomes FULL" },
                { key: "restrictions", label: "Restriction Codes have Changed" },
              ].map((item) => {
                const key = item.key as keyof NotificationFlags;
                const checked = getNotificationFlags(notificationModalCourse.crn)[key];
                return (
                  <button key={item.key} onClick={() => toggleNotificationFlag(notificationModalCourse, key)} className={`w-full text-left px-4 py-3 rounded-lg border font-semibold transition-colors cursor-pointer ${checked ? "bg-amber-100 text-amber-900 border-amber-300" : "bg-[#3a3a3a] text-gray-100 border-gray-500 hover:bg-[#444]"}`}>
                    <span className="mr-3">{checked ? "☑" : "☐"}</span>
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex justify-end">
              <button onClick={() => setNotificationModalCourse(null)} className="px-5 py-2 rounded-md bg-gray-600 hover:bg-gray-500 font-bold cursor-pointer">Done</button>
            </div>
          </div>
        </div>
      )}

      {infoModalCourse && (() => {
        const sections: any[] = Array.isArray(infoModalCourse.sections) ? infoModalCourse.sections : [];
        const sectionCount = sections.length;
        const openSections = sections.filter((s) => (s.seatsAvailable || 0) > 0).length;
        const totalOpen = sections.reduce((a, s) => a + Math.max(0, s.seatsAvailable || 0), 0);
        const totalMax = sections.reduce((a, s) => a + (s.maxEnrollment || 0), 0);
        const meetingLine = (s: any) => {
          const m = (s.meetings || []).find(
            (mm: any) => mm.startTime || (Array.isArray(mm.days) && mm.days.length),
          );
          if (!m) return String(s.instructionMode || "").toUpperCase().includes("HYB") ? "Hybrid" : "Online";
          const days = Array.isArray(m.days) && m.days.length ? m.days.join("") : "TBA";
          const time = m.startTime
            ? `${formatTimeDisplay(m.startTime, is24Hour)}${m.endTime ? " – " + formatTimeDisplay(m.endTime, is24Hour) : ""}`
            : "";
          const loc = [m.building, m.room].filter(Boolean).join(" ");
          return [days, time, loc].filter(Boolean).join(" · ");
        };
        const stats: [string, string][] = [
          ["Sections", String(sectionCount)],
          ["Open", `${openSections}/${sectionCount}`],
          ["Seats", `${totalOpen}/${totalMax}`],
        ];
        return (
          <div className="absolute inset-0 bg-[rgb(7_13_24/0.55)] backdrop-blur-sm flex items-center justify-center z-[70] p-4 sm:p-10" role="dialog" aria-modal="true" aria-label="Course information" onClick={() => setInfoModalCourse(null)}>
            <div className="bg-[var(--cy-surface)] rounded-2xl shadow-[0_40px_90px_-20px_rgba(7,13,24,0.6)] w-full max-w-[620px] border border-[var(--cy-border)] overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
              <div className="bg-charger-blue px-[22px] py-[18px] flex items-start justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-charger-gold">{infoModalCourse.subject} {infoModalCourse.courseNumber}</div>
                  <h3 className="font-serif text-[26px] font-normal text-white mt-1.5 break-words">{infoModalCourse.title || "Course Information"}</h3>
                </div>
                <button onClick={() => setInfoModalCourse(null)} title="Close" className="w-[30px] h-[30px] rounded-lg bg-white/[0.12] text-white text-xl leading-none flex items-center justify-center hover:bg-white/20 transition-colors cursor-pointer shrink-0">×</button>
              </div>
              <div className="px-[22px] py-5 flex flex-col gap-4 overflow-y-auto">
                <p className="text-[13.5px] leading-[1.6] text-[var(--cy-text-2)]">
                  {infoModalCourse.description || "No description is available for this course yet."}
                </p>
                {sectionCount > 0 && (
                  <>
                    <div className="grid grid-cols-3 gap-2.5">
                      {stats.map(([label, value]) => (
                        <div key={label} className="bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-[11px] p-[11px]">
                          <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--cy-text-3)]">{label}</div>
                          <div className="text-[17px] font-bold text-[var(--cy-text)] mt-0.5 font-mono">{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2">
                      {sections.map((s) => (
                        <div key={s.crn} className="flex items-center justify-between gap-3 bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-[11px] px-3 py-2.5">
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-bold text-[var(--cy-text)] font-mono">CRN {s.crn}</div>
                            <div className="font-mono text-[11px] text-[var(--cy-text-2)] truncate">{meetingLine(s)}</div>
                          </div>
                          <div className="shrink-0"><CourseStatusBadge course={s} /></div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="px-[22px] py-4 flex justify-end border-t border-[var(--cy-border)] shrink-0">
                <button onClick={() => setInfoModalCourse(null)} className="px-5 py-2.5 text-[13px] font-bold bg-[var(--cy-surface-2)] border border-[var(--cy-border)] text-[var(--cy-text-2)] hover:border-[#B87A00] hover:text-[#B87A00] rounded-[10px] transition-colors cursor-pointer">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

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
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Event details" onClick={() => setSelectedEvent(null)}>
            {isCustomEvent ? (
              <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl p-6 max-w-xs w-full mx-4 border border-[var(--cy-border)]" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-xl sm:text-2xl font-black text-[var(--cy-text)] truncate pr-2">{selectedEvent.title}</h3>
                  
                  <div className="relative group flex items-center justify-center shrink-0 pt-1">
                    <div 
                      className="peer relative flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--cy-border)] bg-[var(--cy-surface-2)] text-[var(--cy-text-3)] hover:text-[#B87A00] hover:border-[#B87A00] transition-colors cursor-pointer overflow-hidden shrink-0" 
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
                    className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-[var(--cy-text)] rounded-lg font-bold transition-colors shadow-sm cursor-pointer"
                  >
                    Edit Event
                  </button>
                  <button onClick={() => { removeCourseFromSchedule(selectedEvent.courseInfo); setSelectedEvent(null); }} className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors shadow-sm cursor-pointer">Delete Event</button>
                  <button onClick={() => setSelectedEvent(null)} className="w-full py-2.5 mt-2 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-[var(--cy-text-3)] rounded-lg font-bold transition-colors cursor-pointer">Close</button>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4 border border-[var(--cy-border)]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-4 pb-4 border-b border-[var(--cy-border)]">
                  <div className="relative group">
                    <button onClick={() => { setSearchQuery(selectedEvent.title); setTermQuery(selectedEvent.courseInfo.term); setActiveTab("search"); setSelectedEvent(null); }} className="peer flex items-center gap-2 text-[var(--cy-accent)] hover:text-[#B87A00] font-bold text-lg sm:text-xl text-left transition-colors cursor-pointer">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      {selectedEvent.title} {selectedEvent.meetingInfo?.type ? selectedEvent.meetingInfo.type.toUpperCase().substring(0, 3) : "LEC"}
                    </button>
                    <div className="absolute top-[110%] left-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Search for this class<div className="absolute bottom-full left-4 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0 pt-1">
                    
                    <div className="relative group flex items-center justify-center">
                      <div 
                        className="peer relative flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--cy-border)] bg-[var(--cy-surface-2)] text-[var(--cy-text-3)] hover:text-[#B87A00] hover:border-[#B87A00] transition-colors cursor-pointer overflow-hidden shrink-0" 
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
                      <button onClick={() => removeCourseFromSchedule(selectedEvent.courseInfo)} className="peer w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--cy-surface-2)] border border-[var(--cy-border)] text-[var(--cy-text-3)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer shrink-0"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                      <div className="absolute top-[110%] right-0 opacity-0 peer-hover:opacity-100 transition-opacity duration-200 w-max bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-bold py-1.5 px-3 rounded shadow-lg z-50 pointer-events-none">Remove from schedule<div className="absolute bottom-full right-2 border-[5px] border-transparent border-b-gray-900 dark:border-b-gray-100"></div></div>
                    </div>
                  </div>

                </div>
                <div className="space-y-4 text-sm sm:text-base">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[var(--cy-text-2)]">Section code</span>
                    <span className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-gray-800 dark:text-gray-200 font-mono font-medium">{selectedEvent.courseInfo.crn}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[var(--cy-text-2)]">Term</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">{selectedEvent.courseInfo.term}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[var(--cy-text-2)]">Instructors</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium truncate max-w-[60%] text-right" title={instructors}>{instructors}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[var(--cy-text-2)]">Location</span>
                    <span className="text-[var(--cy-accent)] font-medium truncate max-w-[60%] text-right" title={location}>{location}</span>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-[var(--cy-border)]">
                  <button onClick={() => setSelectedEvent(null)} className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-lg text-[var(--cy-text-2)] font-bold transition-colors cursor-pointer">Close</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* SIGN IN MODAL */}
      {isSignInModalOpen && (
        <div className="fixed inset-0 bg-[rgb(7_13_24/0.55)] backdrop-blur-sm flex items-center justify-center z-[100] p-4" role="dialog" aria-modal="true" aria-label="Sign in modal" onClick={() => setIsSignInModalOpen(false)}>
          <div className="bg-[var(--cy-surface)] rounded-2xl shadow-[0_40px_90px_-20px_rgba(7,13,24,0.6)] p-8 w-full max-w-md border border-[var(--cy-border)] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-[var(--cy-text)] mb-6 text-center tracking-wide">Sign in to save your schedules</h3>

            <button onClick={handleGoogleSignIn} disabled={isSigningIn} aria-busy={isSigningIn} className="w-full bg-white hover:bg-white/90 text-[#0b1b33] font-bold py-3.5 px-4 rounded-[11px] flex items-center justify-center gap-3 transition-colors border border-[var(--cy-border)] cursor-pointer disabled:opacity-70 disabled:cursor-wait">
              {isSigningIn ? (
                <svg width="20" height="20" viewBox="0 0 24 24" className="animate-spin" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.6 7l7 5.4c4.2-3.9 6.6-9.6 6.6-15.7z" /><path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.2 5.6C7.9 41 15.4 46 24 46z" /><path fill="#FBBC05" d="M11.5 28.3c-.5-1.4-.7-2.8-.7-4.3s.3-2.9.7-4.3l-7.2-5.6C2.8 17 2 20.4 2 24s.8 7 2.3 9.9l7.2-5.6z" /><path fill="#EA4335" d="M24 10.6c3.3 0 5.5 1.4 6.8 2.6l6.2-6C33.9 3.8 30 2 24 2 15.4 2 7.9 7 4.3 14.1l7.2 5.6C13.3 14.4 18.2 10.6 24 10.6z" /></svg>
              )}
              {isSigningIn ? "Opening Google…" : "Continue with Google"}
            </button>

            <div className="mt-8 flex items-center text-[var(--cy-text-3)] text-xs w-full">
              <div className="flex-1 border-t border-[var(--cy-border)]"></div>
              <span className="px-3 flex items-center gap-1 font-medium">
                Have schedules saved to an old user ID?
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
              </span>
              <div className="flex-1 border-t border-[var(--cy-border)]"></div>
            </div>

            <div className="mt-10 flex justify-end">
              <button onClick={() => setIsSignInModalOpen(false)} className="text-sm font-bold text-[var(--cy-text-3)] hover:text-[var(--cy-text)] transition-colors cursor-pointer">CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {isImportModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[var(--cy-surface)] border border-[var(--cy-border)] rounded-2xl shadow-[0_40px_90px_-20px_rgba(7,13,24,0.6)] p-6 text-[var(--cy-text)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black">Import from myGateway</h2>
                <p className="text-sm text-[var(--cy-text-2)] mt-1">
                  Paste your active registrations text and we’ll auto-add matching CRNs to the current schedule.
                </p>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-[var(--cy-text-3)] hover:text-[var(--cy-text)] cursor-pointer"
                title="Close import dialog"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 text-sm text-[var(--cy-text-2)] space-y-1">
              <p className="font-bold text-[var(--cy-text)]">Where to copy from:</p>
              <p>1) Go to myGateway</p>
              <p>2) Registration → View Registration Information</p>
              <p>3) Active Registrations</p>
              <p>4) Copy from the first class title through each CRN block and paste below.</p>
            </div>

            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={`Introduction to Philosophy, Philosophy & Religious Studies 100 C, Section OL1\nTerm: Summer 2026\nCRN: 30437\nStatus: Registered--Web 04/11/2026`}
              className="mt-4 w-full h-56 rounded-lg bg-[var(--cy-surface-2)] border border-[var(--cy-border)] text-[var(--cy-text-2)] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
            />

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 text-sm font-bold text-[var(--cy-text-2)] hover:text-[var(--cy-text)] cursor-pointer"
              >
                CANCEL
              </button>
              <button
                onClick={() => void handleImportFromMyGateway()}
                disabled={isImporting || !importText.trim()}
                className="px-4 py-2 text-sm font-bold rounded-md bg-charger-blue text-white hover:bg-charger-blue-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isImporting ? "IMPORTING..." : "IMPORT CLASSES"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCustomEventModalOpen && (
        <div className="absolute inset-0 bg-[rgb(7_13_24/0.55)] backdrop-blur-sm flex items-center justify-center z-[70] p-4" role="dialog" aria-modal="true" aria-label="Custom event editor">
          <div className="bg-[var(--cy-surface)] rounded-2xl shadow-[0_40px_90px_-20px_rgba(7,13,24,0.6)] p-6 max-w-md w-full border border-[var(--cy-border)] text-[var(--cy-text)]">
            <h3 className="text-xl font-bold mb-6">{editingCustomEventCrn ? "Edit Custom Event" : "Add a Custom Event"}</h3>
            
            <div className="space-y-5">
              <div className="relative">
                <input type="text" value={customEventName} onChange={(e) => setCustomEventName(e.target.value)} className="w-full bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[#B87A00] peer cursor-text" placeholder=" " />
                <label className="absolute left-3 -top-2.5 bg-[var(--cy-surface)] px-1 text-xs text-[var(--cy-text-3)] transition-all peer-placeholder-shown:text-base peer-placeholder-shown:text-[var(--cy-text-3)] peer-placeholder-shown:top-3 peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-[var(--cy-text-2)] pointer-events-none">Event Name</label>
              </div>

              <div className="relative">
                <select 
                  value={customEventBuilding}
                  onChange={(e) => setCustomEventBuilding(e.target.value)}
                  className="w-full bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[#B87A00] appearance-none cursor-pointer"
                >
                  <option value="">No Location (TBA)</option>
                  {Object.entries(BUILDINGS).map(([code, building]) => (
                    <option key={code} value={code}>{building.name} ({code})</option>
                  ))}
                </select>
                <label className="absolute left-3 -top-2.5 bg-[var(--cy-surface)] px-1 text-xs text-[var(--cy-text-3)] pointer-events-none">Location (Map Pin)</label>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-[var(--cy-text-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="relative flex-1">
                  <input type="time" value={customEventStartTime} onChange={(e) => setCustomEventStartTime(e.target.value)} className="w-full bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[#B87A00] css-time-input cursor-pointer" />
                  <label className="absolute left-3 -top-2.5 bg-[var(--cy-surface)] px-1 text-xs text-[var(--cy-text-3)] pointer-events-none">Start Time</label>
                </div>
                <div className="relative flex-1">
                  <input type="time" value={customEventEndTime} onChange={(e) => setCustomEventEndTime(e.target.value)} className="w-full bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[#B87A00] css-time-input cursor-pointer" />
                  <label className="absolute left-3 -top-2.5 bg-[var(--cy-surface)] px-1 text-xs text-[var(--cy-text-3)] pointer-events-none">End Time</label>
                </div>
              </div>

              <style dangerouslySetInnerHTML={{__html: `.css-time-input::-webkit-calendar-picker-indicator { cursor: pointer; } .dark .css-time-input::-webkit-calendar-picker-indicator { filter: invert(1); }`}} />

              <div className="flex rounded-md overflow-hidden border border-[var(--cy-border)] bg-[var(--cy-surface-2)]">
                {["Su", "M", "Tu", "W", "Th", "F", "Sa"].map((day, i) => (
                  <button key={day} onClick={() => toggleCustomDay(day)} className={`flex-1 py-2.5 text-xs font-bold border-r border-[var(--cy-border)] last:border-r-0 transition-colors cursor-pointer ${customEventDays.includes(day) ? 'bg-charger-blue text-white' : 'text-[var(--cy-text-3)] hover:bg-[var(--cy-surface)]'}`}>{day.charAt(0)}</button>
                ))}
              </div>

              <div className="relative">
                <select value={customEventScheduleId || activeScheduleId} onChange={(e) => setCustomEventScheduleId(e.target.value)} className="w-full bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[#B87A00] appearance-none cursor-pointer">
                  {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <label className="absolute left-3 -top-2.5 bg-[var(--cy-surface)] px-1 text-xs text-[var(--cy-text-3)] pointer-events-none">Select schedule</label>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none"><svg className="w-4 h-4 text-[var(--cy-text-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg></div>
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button onClick={() => setIsCustomEventModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-[var(--cy-text-2)] hover:text-[var(--cy-text)] transition-colors cursor-pointer">CANCEL</button>
              <button onClick={handleAddCustomEvent} disabled={!customEventName.trim() || customEventDays.length === 0} className={`px-5 py-2.5 text-sm font-bold rounded-md transition-colors cursor-pointer ${!customEventName.trim() || customEventDays.length === 0 ? 'bg-[var(--cy-surface-2)] text-[var(--cy-text-3)] cursor-not-allowed' : 'bg-charger-blue text-white hover:bg-charger-blue-hover'}`}>{editingCustomEventCrn ? "UPDATE EVENT" : "SAVE EVENT"}</button>
            </div>
          </div>
        </div>
      )}

      {shareFallbackUrl && (
        <div className="absolute inset-0 bg-[rgb(7_13_24/0.55)] backdrop-blur-sm flex items-center justify-center z-[70] p-4" role="dialog" aria-modal="true" aria-label="Copy share link">
          <div className="bg-[var(--cy-surface)] rounded-2xl shadow-[0_40px_90px_-20px_rgba(7,13,24,0.6)] p-6 max-w-md w-full border border-[var(--cy-border)] text-[var(--cy-text)]">
            <h3 className="text-xl font-bold mb-2">Your share link is ready</h3>
            <p className="text-sm text-[var(--cy-text-2)] mb-4">Your browser blocked the automatic copy, so here it is — select and copy.</p>
            <input
              readOnly
              value={shareFallbackUrl}
              onFocus={(e) => e.currentTarget.select()}
              autoFocus
              className="w-full bg-[var(--cy-surface-2)] border border-[var(--cy-border)] rounded-md px-3 py-2.5 text-xs font-mono focus:outline-none focus:border-[#B87A00] cursor-text"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={async () => {
                  if (await copyTextToClipboard(shareFallbackUrl)) {
                    setShareFallbackUrl(null);
                    showToast("Link copied", "Short share link copied to clipboard.");
                  }
                }}
                className="h-10 px-3 rounded-lg bg-charger-gold text-charger-gold-ink text-sm font-bold hover:bg-charger-gold-hover cursor-pointer"
              >
                Copy
              </button>
              <button
                onClick={() => setShareFallbackUrl(null)}
                className="h-10 px-3 rounded-lg border border-[var(--cy-border)] text-sm font-bold text-[var(--cy-text-2)] hover:bg-[var(--cy-surface-2)] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast lives inside the assistant column so the flex stack keeps it clear of the
          "Ask the assistant" button — and of the chat panel when that is open. It used to
          be anchored to the same corner at the same z-index, so the button covered it. */}
      <div className="fixed bottom-[80px] right-4 lg:bottom-6 lg:right-6 z-50 flex flex-col items-end">
        {toastMessage && (
          <div className="mb-3 bg-yellow-50 dark:bg-yellow-900/90 border-l-4 border-yellow-500 text-yellow-800 dark:text-yellow-100 p-4 rounded-lg shadow-2xl flex items-start gap-3 max-w-[min(24rem,calc(100vw-2rem))] transition-all duration-300 transform translate-y-0 opacity-100 pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-500 dark:text-yellow-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div className="flex-1"><p className="font-bold text-sm">{toastMessage.title}</p><p className="text-xs mt-1 font-medium">{toastMessage.body}</p></div>
            <button onClick={() => setToastMessage(null)} className="text-yellow-600 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-100 shrink-0 pointer-events-auto cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        )}
        {isChatOpen && (
          <div className="mb-3 w-[92vw] max-w-sm rounded-2xl border border-[var(--cy-border)] bg-[var(--cy-surface)] shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-charger-blue text-white flex items-center justify-between">
              <div className="flex items-start gap-2.5">
                <span className="w-2 h-2 rounded-full bg-charger-gold mt-1.5 shrink-0"></span>
                <div>
                  <p className="text-sm font-bold">Scheduler Assistant</p>
                  <p className="text-[11px] opacity-90">Questions about classes, schedules, and app features</p>
                </div>
              </div>
              <button
                onClick={() => setIsChatOpen(false)}
                className="p-1.5 rounded hover:bg-white/20 cursor-pointer"
                title="Close AI assistant"
                aria-label="Close AI assistant"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="h-72 overflow-y-auto px-3 py-3 space-y-2 bg-[var(--cy-bg)]">
              {chatMessages.map((message, idx) => (
                <div
                  key={`${message.role}-${idx}`}
                  className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-charger-blue text-white ml-6"
                      : "bg-[var(--cy-chip)] text-[var(--cy-text-2)] mr-6 border border-[var(--cy-border)]"
                  }`}
                >
                  {message.content}
                </div>
              ))}
              {isChatLoading && (
                <div className="rounded-xl px-3 py-2 text-sm bg-[var(--cy-chip)] text-[var(--cy-text-3)] mr-6 border border-[var(--cy-border)]">
                  Thinking...
                </div>
              )}
            </div>
            <div className="p-3 border-t border-[var(--cy-border)] bg-[var(--cy-surface)]">
              <div className="flex items-end gap-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendChatMessage();
                    }
                  }}
                  placeholder="Ask about finding classes, scheduling, or app features..."
                  className="flex-1 resize-none rounded-lg border border-[var(--cy-border)] bg-[var(--cy-surface-2)] px-3 py-2 text-sm text-[var(--cy-text)] focus:outline-none focus:ring-2 focus:ring-[#B87A00]"
                  rows={2}
                />
                <button
                  onClick={() => void sendChatMessage()}
                  disabled={isChatLoading || !chatInput.trim()}
                  className="h-10 px-3 rounded-lg bg-charger-gold text-charger-gold-ink text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-charger-gold-hover cursor-pointer"
                  title="Send message"
                  aria-label="Send message"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() => setIsChatOpen((prev) => !prev)}
          className="flex items-center gap-2 rounded-full bg-charger-blue hover:bg-charger-blue-hover text-white text-[13px] font-bold px-[18px] py-[11px] shadow-[0_10px_24px_-8px_rgba(11,44,94,0.6)] cursor-pointer"
          title={isChatOpen ? "Hide AI assistant" : "Open AI assistant"}
          aria-label={isChatOpen ? "Hide AI assistant" : "Open AI assistant"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.1A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
          Ask the assistant
        </button>
      </div>
    </div>
  );
}
