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
 *
 * Cypress College theme: charger blue for course codes, charger gold for the
 * add action and the instructor chip. Colors come from the --cy-* tokens in
 * globals.css so light and dark share one markup path.
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

  const hasNonRemoteTag = allTags.some((tag) => tag !== "ONLINE" && tag !== "HYBRID");
  if (hasNonRemoteTag) {
    allTags = allTags.filter((tag) => tag !== "ONLINE" && tag !== "HYBRID");
  }
  if (allTags.length === 0) allTags = ["ONLINE"];
  const uniqueTags: string[] = Array.from(new Set(allTags));

  const profName = course.professors?.[0];
  const rmpUrl = getRmpUrl(profName);

  const containerStyle: CSSProperties = isAdded ? { borderLeft: `6px solid ${courseColor}` } : {};

  const chipBase =
    "text-[10px] px-[7px] py-[3px] rounded-[5px] font-bold border font-mono";
  const iconButton =
    "flex items-center justify-center w-8 h-8 rounded-[9px] border transition-colors cursor-pointer shrink-0";

  return (
    <div
      className={`p-3 rounded-xl border transition-colors bg-[var(--cy-surface-2)] border-[var(--cy-border)] ${
        isAdded ? "" : "hover:border-[#B87A00]"
      }`}
      style={containerStyle}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="font-extrabold text-[14.5px] tracking-[-0.01em] text-[var(--cy-accent)] break-words">
              {course.subject ? `${course.subject} ${course.courseNumber}` : course.courseNumber}
            </h2>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenInfo(course);
              }}
              className="p-0.5 rounded-full text-[var(--cy-text-3)] hover:text-[#B87A00] transition-colors cursor-pointer"
              title="Course Information"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-[15px] h-[15px]"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
            </button>
          </div>

          {(!isAdded || visibleColumns.title) && (
            <p className="text-[11.5px] font-medium leading-[1.35] text-[var(--cy-text-2)] mt-[3px] mb-2 break-words">
              {course.title || "Title TBA"}
            </p>
          )}

          {(!isAdded || visibleColumns.times || visibleColumns.instructors) && (
            <div className="flex flex-wrap gap-[5px]">
              {(!isAdded || visibleColumns.times) &&
                uniqueTags.map((tag) => (
                  <span
                    key={tag}
                    className={`${chipBase} bg-[var(--cy-chip)] border-[var(--cy-border)] text-[var(--cy-text-2)]`}
                  >
                    {tag}
                  </span>
                ))}

              {(!isAdded || visibleColumns.instructors) &&
                (rmpUrl && course.subject ? (
                  <a
                    href={rmpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] px-[7px] py-[3px] rounded-[5px] font-bold border bg-[rgb(184_122_0/0.12)] border-[rgb(184_122_0/0.30)] text-[var(--cy-gold)] hover:bg-[rgb(184_122_0/0.20)] transition-colors cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {profName}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-75" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                  </a>
                ) : profName && profName.toUpperCase() === "STAFF" ? (
                  <span className={`${chipBase} bg-[var(--cy-chip)] border-[var(--cy-border)] text-[var(--cy-text-3)] cursor-default`}>
                    STAFF
                  </span>
                ) : null)}
            </div>
          )}

          {course.subject && (!isAdded || visibleColumns.status || visibleColumns.crn) && (
            <div className="flex flex-wrap items-center gap-2 mt-[9px]">
              {(!isAdded || visibleColumns.status) && renderStatusBadge(course)}

              {(!isAdded || visibleColumns.crn) && (
                <p className="text-[10px] font-mono text-[var(--cy-text-3)]">
                  CRN {course.crn} · {(course.maxEnrollment || 0) - (course.seatsAvailable || 0)}/{course.maxEnrollment || 0} enrolled
                </p>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col gap-1.5">
          {onToggleNotification && (
            <button
              onClick={() => onToggleNotification(course)}
              disabled={isNotificationDisabled}
              className={`${iconButton} ${
                isNotificationEnabled
                  ? "bg-[rgb(232_163_23/0.14)] border-[rgb(184_122_0/0.35)] text-[var(--cy-gold)]"
                  : "bg-[var(--cy-surface)] border-[var(--cy-border)] text-[var(--cy-text-3)]"
              } ${
                isNotificationDisabled
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:text-[#B87A00] hover:border-[#B87A00]"
              }`}
              title={
                isNotificationDisabled
                  ? notificationDisabledReason || "Notifications unavailable for this term."
                  : "Notification settings"
              }
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill={isNotificationEnabled ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-[15px] h-[15px]">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 1 5.454 1.31A8.967 8.967 0 0 1 18 9.75V9a6 6 0 1 0-12 0v.75a8.967 8.967 0 0 1-2.312 6.642A23.848 23.848 0 0 1 9.143 17.082m5.714 0a24.255 24.255 0 0 0-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
            </button>
          )}

          {isAdded ? (
            <>
              <div
                className={`${iconButton} relative overflow-hidden bg-[var(--cy-surface)] border-[var(--cy-border)] text-[var(--cy-text-3)] hover:text-[#B87A00] hover:border-[#B87A00]`}
                title="Change Color"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" /><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" /><path d="M14.5 17.5 4.5 15" /></svg>
                <input
                  type="color"
                  value={getCourseColor(course.crn)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-[200%] h-[200%] -top-1/2 -left-1/2"
                  onChange={(e) => onColorChange(course.crn, e.target.value)}
                />
              </div>

              <button
                onClick={() => onRemoveCourse(course)}
                className={`${iconButton} bg-[rgb(176_65_62/0.08)] border-[rgb(176_65_62/0.30)] text-[#B0413E] hover:bg-[rgb(176_65_62/0.16)]`}
                title="Remove from schedule"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-[15px] h-[15px]"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </>
          ) : (
            <button
              onClick={() => onAddCourse(course)}
              className={`${iconButton} border-transparent bg-charger-gold text-charger-gold-ink hover:bg-charger-gold-hover`}
              title="Add to schedule"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-[15px] h-[15px]"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
