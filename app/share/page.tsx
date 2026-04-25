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

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 text-gray-800 dark:text-gray-100">
      <h1 className="text-3xl font-black mb-2">Shared Schedule</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {shared.name} • generated {new Date(shared.generatedAt).toLocaleString()}
      </p>

      <div className="space-y-3">
        {shared.courses.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No courses in this shared schedule.</p>
        ) : (
          shared.courses.map((course: any, index) => (
            <div key={`${course?.crn || "item"}-${index}`} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
              <h2 className="font-bold text-lg">
                {course?.subject ? `${course.subject} ${course.courseNumber}` : course?.title || "Course"}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {course?.title || "No title"} {course?.crn ? `• CRN ${course.crn}` : ""}
              </p>
              {course?.term && (
                <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">{course.term}</p>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
