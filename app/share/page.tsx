import Link from "next/link";
import { verifySignedSharePayload } from "@/lib/share";

type SharePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const payload = typeof params.payload === "string" ? params.payload : "";
  const sig = typeof params.sig === "string" ? params.sig : "";
  const shared = verifySignedSharePayload(payload, sig);

  if (!shared) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-10 text-gray-800 dark:text-gray-100">
        <h1 className="text-2xl font-black mb-3">Invalid share link</h1>
        <p className="mb-6">This schedule link is invalid or has been tampered with.</p>
        <Link href="/" className="text-blue-600 dark:text-blue-400 font-semibold">Return to Scheduler</Link>
      </main>
    );
  }

  const items = shared.courses as any[];
  const unitTotal = items.reduce((sum, item) => sum + Number(item?.units || 0), 0);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-orange-50 dark:from-gray-950 dark:to-gray-900 px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white/90 dark:bg-gray-900/90 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg p-6 mb-6">
          <p className="text-xs font-black uppercase tracking-wider text-orange-600 dark:text-orange-400">Shared from Cypress Scheduler</p>
          <h1 className="text-3xl font-black mt-1 mb-2 text-gray-900 dark:text-gray-100">{shared.name}</h1>
          <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-300">
            <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">{items.length} items</span>
            <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">{unitTotal} units</span>
            <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">Generated {new Date(shared.generatedAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="space-y-3">
          {items.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No courses in this shared schedule.</p>
          ) : (
            items.map((course: any, index) => (
              <article key={`${course?.crn || "item"}-${index}`} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 shadow-sm">
                <h2 className="font-extrabold text-lg text-gray-900 dark:text-gray-100">
                  {course?.subject ? `${course.subject} ${course.courseNumber}` : course?.title || "Course"}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">{course?.title || "No title available"}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {course?.term && <span className="px-2 py-1 rounded bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">{course.term}</span>}
                  {course?.crn && <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">CRN {course.crn}</span>}
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">{Number(course?.units || 0)} units</span>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
