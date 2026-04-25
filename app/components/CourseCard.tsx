import type { CSSProperties, ReactNode } from "react";

type VisibleColumns = {
  title: boolean;
  times: boolean;
  instructors: boolean;
  status: boolean;
  crn: boolean;
};

type CourseCardProps = {
  course: any;
  isAdded: boolean;
  is24Hour: boolean;
  visibleColumns: VisibleColumns;
  getCourseColor: (crn: string) => string;
  formatTimeDisplay: (time24: string, is24Hour: boolean) => string;
  getRmpUrl: (profName: string) => string | null;
  onOpenInfo: (course: any) => void;
  onColorChange: (crn: string, newColor: string) => void;
  onRemoveCourse: (course: any) => void;
  onAddCourse: (course: any) => void;
  renderStatusBadge: (course: any) => ReactNode;
  onToggleNotification?: (course: any) => void;
  isNotificationEnabled?: boolean;
  isNotificationDisabled?: boolean;
  notificationDisabledReason?: string;
};

/**
 * Reusable course row used by both search results and the added-courses tab.
 * Behavior changes via `isAdded` to show add/remove + color controls.
 */
export default function CourseCard({
  course,
  isAdded,
  is24Hour,
  visibleColumns,
  getCourseColor,
  formatTimeDisplay,
  getRmpUrl,
  onOpenInfo,
  onColorChange,
  onRemoveCourse,
  onAddCourse,
  renderStatusBadge,
  onToggleNotification,
  isNotificationEnabled = false,
  isNotificationDisabled = false,
  notificationDisabledReason,
}: CourseCardProps) {
  const courseColor = getCourseColor(course.crn);
  const instructionMode = String(course.instructionMode || "").toUpperCase();

  let allTags: string[] =
    course.meetings?.map((m: any) => {
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

  if (allTags.length === 0) allTags = ["ONLINE"];
  const uniqueTags: string[] = Array.from(new Set(allTags));

  const profName = course.professors?.[0];
  const rmpUrl = getRmpUrl(profName);

  const containerStyle: CSSProperties = isAdded ? { borderLeft: `6px solid ${courseColor}` } : {};

  return (
    <div
      className={`p-4 border rounded-xl shadow-sm transition-all ${
        isAdded
          ? "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-500 cursor-default"
      }`}
      style={containerStyle}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="font-extrabold text-blue-900 dark:text-blue-400 text-sm sm:text-base break-words">
              {course.subject ? `${course.subject} ${course.courseNumber}` : course.courseNumber}
            </h2>
            <button onClick={(e) => { e.stopPropagation(); onOpenInfo(course); }} className="p-1 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer" title="Course Information">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
            </button>
          </div>

          {(!isAdded || visibleColumns.title) && (
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2 break-words">{course.title || "Title TBA"}</p>
          )}

          {(!isAdded || visibleColumns.times || visibleColumns.instructors) && (
            <div className="flex flex-wrap gap-1 mb-2">
              {(!isAdded || visibleColumns.times) && uniqueTags.map((tag) => (
                <span key={tag} className={`text-[10px] px-2 py-0.5 rounded font-bold border ${tag === 'ONLINE' ? 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-900/30 dark:border-orange-800 dark:text-orange-300' : 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-300'}`}>{tag}</span>
              ))}

              {(!isAdded || visibleColumns.instructors) && (
                rmpUrl && course.subject ? (
                  <a href={rmpUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-bold bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-200 dark:hover:bg-purple-800 transition-colors cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    {profName}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-75" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                  </a>
                ) : profName && profName.toUpperCase() === "STAFF" ? (
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 cursor-default">STAFF</span>
                ) : null
              )}
            </div>
          )}

          {course.subject && (!isAdded || visibleColumns.status || visibleColumns.crn) && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {(!isAdded || visibleColumns.status) && renderStatusBadge(course)}

              {(!isAdded || visibleColumns.crn) && (
                <p className="text-[10px] text-gray-500 font-mono font-medium">
                  CRN: {course.crn} • {(course.maxEnrollment || 0) - (course.seatsAvailable || 0)}/{course.maxEnrollment || 0} Enrolled
                </p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-end w-full sm:w-auto mt-2 sm:mt-0 gap-2">
          {onToggleNotification && (
            <button
              onClick={() => onToggleNotification(course)}
              disabled={isNotificationDisabled}
              className={`p-2 rounded-lg border transition-colors flex items-center justify-center w-9 h-9 ${
                isNotificationEnabled
                  ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
                  : "bg-white text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700"
              } ${
                isNotificationDisabled
                  ? "opacity-40 cursor-not-allowed"
                  : "cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              title={isNotificationDisabled ? notificationDisabledReason || "Notifications unavailable for this term." : "Notification settings"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill={isNotificationEnabled ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 1 5.454 1.31A8.967 8.967 0 0 1 18 9.75V9a6 6 0 1 0-12 0v.75a8.967 8.967 0 0 1-2.312 6.642A23.848 23.848 0 0 1 9.143 17.082m5.714 0a24.255 24.255 0 0 0-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
            </button>
          )}
          {isAdded ? (
            <>
              <div className="relative group flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500 transition-colors cursor-pointer overflow-hidden shrink-0" title="Change Color">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>
                <input
                  type="color"
                  value={getCourseColor(course.crn)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-[200%] h-[200%] -top-1/2 -left-1/2"
                  onChange={(e) => onColorChange(course.crn, e.target.value)}
                />
              </div>

              <button onClick={() => onRemoveCourse(course)} className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 p-2 rounded-lg cursor-pointer transition-colors hover:bg-red-100 dark:hover:bg-red-900/50 flex items-center justify-center w-9 h-9">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </>
          ) : (
            <button onClick={() => onAddCourse(course)} className="bg-orange-600 hover:bg-orange-700 text-white p-2 rounded-lg cursor-pointer transition-colors shadow-sm flex items-center justify-center w-9 h-9">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
