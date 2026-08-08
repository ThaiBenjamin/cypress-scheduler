import Link from "next/link";
import { verifySignedSharePayload } from "@/lib/share";

type SharePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const COURSE_COLORS = ["#1A4C93", "#C77700", "#2E7D6B", "#5B4B8A", "#B0413E", "#5A6779"];

function meetingLine(course: any): string | null {
  const m = (course?.meetings || []).find(
    (mm: any) => mm?.startTime || (Array.isArray(mm?.days) && mm.days.length),
  );
  if (!m) return null;
  const days = Array.isArray(m.days) && m.days.length ? m.days.join("") : "";
  const time = m.startTime ? `${m.startTime}${m.endTime ? "–" + m.endTime : ""}` : "";
  return [days, time].filter(Boolean).join(" ") || null;
}

function roomLine(course: any): string | null {
  const m = (course?.meetings || []).find((mm: any) => mm?.building || mm?.room);
  if (!m) return null;
  return [m.building, m.room].filter(Boolean).join(" ") || null;
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const payload = typeof params.payload === "string" ? params.payload : "";
  const sig = typeof params.sig === "string" ? params.sig : "";
  const shared = verifySignedSharePayload(payload, sig);

  if (!shared) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-10 text-[var(--cy-text)]">
        <h1 className="text-2xl font-black mb-3">Invalid share link</h1>
        <p className="mb-6">This schedule link is invalid or has been tampered with.</p>
        <Link href="/" className="text-[var(--cy-accent)] font-semibold">Return to Scheduler</Link>
      </main>
    );
  }

  const items = shared.courses as any[];
  const unitTotal = items.reduce((sum, item) => sum + Number(item?.units || 0), 0);
  const generated = new Date(shared.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="min-h-screen bg-[var(--cy-bg)] px-4 sm:px-8 py-8">
      <div className="max-w-[760px] mx-auto flex flex-col gap-[18px]">
        {/* Header card */}
        <div className="bg-[var(--cy-surface)] border border-[var(--cy-border)] rounded-2xl p-[22px]">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--cy-gold)]">Shared from Cypress Scheduler</p>
          <h1 className="font-serif text-[34px] font-normal mt-2 mb-3 text-[var(--cy-text)] break-words">{shared.name}</h1>
          <div className="flex flex-wrap gap-2 text-[12.5px] text-[var(--cy-text-2)]">
            <span className="px-2.5 py-1.5 rounded-md bg-[var(--cy-chip)] border border-[var(--cy-border)]">{items.length} items</span>
            <span className="px-2.5 py-1.5 rounded-md bg-[var(--cy-chip)] border border-[var(--cy-border)]">{unitTotal} units</span>
            <span className="px-2.5 py-1.5 rounded-md bg-[var(--cy-chip)] border border-[var(--cy-border)]">Generated {generated}</span>
          </div>
        </div>

        {/* Course articles */}
        {items.length === 0 ? (
          <p className="text-[var(--cy-text-3)]">No courses in this shared schedule.</p>
        ) : (
          items.map((course: any, index) => {
            const color = course?.color || COURSE_COLORS[index % COURSE_COLORS.length];
            const meet = meetingLine(course);
            const room = roomLine(course);
            return (
              <article
                key={`${course?.crn || "item"}-${index}`}
                className="bg-[var(--cy-surface)] border border-[var(--cy-border)] rounded-[13px] px-[18px] py-4"
                style={{ borderLeft: `6px solid ${color}` }}
              >
                <h2 className="text-[17px] font-extrabold text-[var(--cy-text)]">
                  {course?.subject ? `${course.subject} ${course.courseNumber}` : course?.title || "Course"}
                </h2>
                <p className="text-[13px] text-[var(--cy-text-2)] mt-0.5 mb-2.5">{course?.title || "No title available"}</p>
                <div className="flex flex-wrap gap-[7px] text-[11px] font-semibold">
                  {course?.term && (
                    <span className="px-2.5 py-1 rounded-md bg-[rgb(232_163_23/0.12)] text-[var(--cy-wait-text)]">{course.term}</span>
                  )}
                  {meet && (
                    <span className="px-2.5 py-1 rounded-md bg-[var(--cy-chip)] text-[var(--cy-text-2)] font-mono">{meet}</span>
                  )}
                  {room && (
                    <span className="px-2.5 py-1 rounded-md bg-[var(--cy-chip)] text-[var(--cy-text-2)] font-mono">{room}</span>
                  )}
                  {course?.crn && (
                    <span className="px-2.5 py-1 rounded-md bg-[var(--cy-chip)] text-[var(--cy-text-2)] font-mono">CRN {course.crn}</span>
                  )}
                </div>
              </article>
            );
          })
        )}

        {/* CTA */}
        <div className="flex items-center justify-between gap-4 bg-charger-blue rounded-[13px] px-[18px] py-4">
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-white">Want your own?</div>
            <div className="text-[12.5px] text-white/65 mt-0.5">Read-only link. Plans stay private until you share them.</div>
          </div>
          <Link
            href="/"
            className="shrink-0 bg-charger-gold hover:bg-charger-gold-hover text-charger-gold-ink rounded-[10px] px-4 py-2.5 text-[13px] font-bold whitespace-nowrap transition-colors"
          >
            Open Scheduler
          </Link>
        </div>
      </div>
    </main>
  );
}
