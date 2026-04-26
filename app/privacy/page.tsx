export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10 text-gray-800 dark:text-gray-100">
      <h1 className="text-3xl font-black mb-4">Privacy Policy</h1>
      <p className="mb-4">
        Cypress Scheduler stores schedule planning data and app preferences to
        provide planning features.
      </p>
      <ul className="list-disc pl-6 space-y-2 mb-6">
        <li>Account identity is provided by Google Sign-In.</li>
        <li>Saved schedules are tied to the signed-in account email.</li>
        <li>Email alerts are sent only to the signed-in account email.</li>
      </ul>
      <p>
        For questions, updates, or account data requests, contact
        cypressschedulersupport@gmail.com.
      </p>
    </main>
  );
}
