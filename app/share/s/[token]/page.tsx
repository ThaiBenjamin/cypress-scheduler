import Link from "next/link";
import { verifySignedShareToken } from "@/lib/share";

type ShareTokenPageProps = {
  params: Promise<{ token: string }>;
};

export default async function ShareTokenPage({ params }: ShareTokenPageProps) {
  const { token } = await params;
  const shared = verifySignedShareToken(token);

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

  return (
    <main className="min-h-screen bg-[var(--cy-bg)] px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="bg-[var(--cy-surface)] border border-[var(--cy-border)] rounded-2xl shadow-lg p-6 mb-6">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--cy-gold)]">Shared from Cypress Scheduler</p>
          <h1 className="text-3xl font-black mt-1 mb-2 text-[var(--cy-text)]">{shared.name}</h1>
          <div className="flex flex-wrap gap-3 text-sm text-[var(--cy-text-2)]">
            <span className="px-2 py-1 rounded bg-[var(--cy-chip)]">{items.length} items</span>
            <span className="px-2 py-1 rounded bg-[var(--cy-chip)]">{unitTotal} units</span>
            <span className="px-2 py-1 rounded bg-[var(--cy-chip)]">Generated {new Date(shared.generatedAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="space-y-3">
          {items.length === 0 ? (
            <p className="text-[var(--cy-text-3)]">No courses in this shared schedule.</p>
          ) : (
            items.map((course, index) => (
              <article key={`${course?.crn || "item"}-${index}`} className="rounded-xl border border-[var(--cy-border)] p-4 bg-[var(--cy-surface)] shadow-sm">
                <h2 className="font-extrabold text-lg text-[var(--cy-text)]">
                  {course?.subject ? `${course.subject} ${course.courseNumber}` : course?.title || "Course"}
                </h2>
                <p className="text-sm text-[var(--cy-text-2)]">{course?.title || "No title available"}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {course?.term && <span className="px-2 py-1 rounded bg-[rgb(184_122_0/0.12)] text-[var(--cy-gold)] border border-[rgb(184_122_0/0.30)]">{course.term}</span>}
                  {course?.crn && <span className="px-2 py-1 rounded bg-[var(--cy-chip)] text-[var(--cy-text-2)]">CRN {course.crn}</span>}
                  <span className="px-2 py-1 rounded bg-[var(--cy-chip)] text-[var(--cy-text-2)]">{Number(course?.units || 0)} units</span>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
