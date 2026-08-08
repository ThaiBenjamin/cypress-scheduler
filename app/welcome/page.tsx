"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";

// Signed-out landing page (README §Screens 3). Cypress College blue-and-gold.
// Reachable at /welcome; "Try it without signing in" drops into the scheduler at /.

const LOGO = (
  <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-charger-gold shrink-0">
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="#0b2c5e"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  </span>
);

const GoogleG = (
  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" aria-hidden>
    <path fill="#4285F4" d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.26a12 12 0 0 0 0 10.76l4.01-3.1Z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.26 6.62l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
  </svg>
);

const STATS = [
  { n: "34", label: "campus buildings mapped" },
  { n: "Daily", label: "catalog sync from NOCCCD" },
  { n: "3", label: "terms available at once" },
];

const STEPS = [
  { n: "1", title: "Search the catalog", body: "Find sections by title, subject, or CRN across Cypress College's live schedule." },
  { n: "2", title: "Build your week", body: "Add sections to a visual calendar that flags time conflicts automatically." },
  { n: "3", title: "Save & share", body: "Sign in to save plans to the cloud and share read-only links with friends." },
];

const FEATURES = [
  { title: "Conflict detection", body: "Overlapping meeting times are flagged the moment you add a class." },
  { title: "Campus map", body: "See where each class meets and the walking routes between them." },
  { title: "myGateway import", body: "Paste your myGateway schedule to bring existing classes straight in." },
  { title: "Schedule optimizer", body: "Rank conflict-free schedule options against your preferences." },
  { title: "Seat notifications", body: "Get an optional email when a watched section's status changes." },
  { title: "AI assistant", body: "Ask the in-app assistant to find classes and answer scheduling questions." },
];

// A small static replica of the calendar grid for the hero.
const HERO_EVENTS = [
  { col: 0, top: 8, h: 40, color: "#1A4C93", code: "MATH 141" },
  { col: 1, top: 32, h: 52, color: "#2E7D6B", code: "BIOL 101" },
  { col: 2, top: 14, h: 34, color: "#C77700", code: "ENGL 100" },
  { col: 3, top: 52, h: 46, color: "#5B4B8A", code: "PSCI 101" },
  { col: 0, top: 96, h: 40, color: "#B0413E", code: "CHEM 111" },
  { col: 3, top: 108, h: 34, color: "#5A6779", code: "HIST 170" },
];

export default function WelcomePage() {
  const router = useRouter();
  const { status } = useSession();

  // Already signed in? Go straight to the scheduler.
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  const startGuest = () => {
    if (typeof window !== "undefined") localStorage.setItem("cyp_guest", "1");
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-[var(--cy-bg)] font-sans text-[var(--cy-text)]">
      {/* HERO */}
      <section className="bg-charger-blue text-white">
        <div className="max-w-6xl mx-auto px-6">
          {/* nav */}
          <nav className="h-[72px] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {LOGO}
              <span className="font-serif text-[21px]">Cypress Scheduler</span>
            </div>
            <div className="flex items-center gap-6 text-[13px] font-semibold text-white/80">
              <a href="#features" className="hidden sm:inline hover:text-white transition-colors">Features</a>
              <a href="#how" className="hidden sm:inline hover:text-white transition-colors">How it works</a>
              <Link href="/api/health" className="hidden sm:inline hover:text-white transition-colors">Status</Link>
              <button
                onClick={() => signIn("google", { callbackUrl: "/" })}
                className="text-charger-gold hover:text-charger-gold-hover transition-colors cursor-pointer"
              >
                Sign in
              </button>
            </div>
          </nav>

          {/* grid */}
          <div className="grid lg:grid-cols-2 gap-14 pt-13 pb-16 lg:pb-24" style={{ paddingTop: 52 }}>
            {/* left */}
            <div className="max-w-[520px]">
              <span className="inline-flex items-center rounded-full border border-charger-gold/50 text-charger-gold text-[11px] font-bold uppercase tracking-[0.14em] px-3 py-1.5">
                Built for Cypress College
              </span>
              <h1
                className="font-serif mt-5 text-[42px] sm:text-[60px] leading-[1.04] tracking-[-0.015em] text-balance"
              >
                Build your semester on one screen.
              </h1>
              <p className="mt-5 text-[16.5px] leading-[1.6] text-white/75">
                Search Cypress College sections, drop them onto a visual calendar,
                catch time conflicts instantly, and preview where each class meets —
                all in one place.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => signIn("google", { callbackUrl: "/" })}
                  className="inline-flex items-center justify-center gap-2.5 rounded-[11px] bg-white text-[#0b1b33] text-[13px] font-bold px-5 py-3 border border-transparent hover:bg-white/90 transition-colors cursor-pointer"
                >
                  {GoogleG}
                  Continue with Google
                </button>
                <button
                  onClick={startGuest}
                  className="inline-flex items-center justify-center rounded-[11px] text-[13px] font-bold px-5 py-3 border border-white/30 text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Try it without signing in
                </button>
              </div>

              <div className="mt-10 pt-6 border-t border-white/15 grid grid-cols-3 gap-4">
                {STATS.map((s) => (
                  <div key={s.label}>
                    <div className="font-serif text-[28px] leading-none">{s.n}</div>
                    <div className="mt-1.5 text-[11.5px] leading-snug text-white/60">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* right — tilted calendar card */}
            <div className="hidden lg:flex items-center justify-center">
              <div
                className="w-full max-w-[420px] rounded-[14px] bg-white p-3.5 text-[#0b1b33]"
                style={{ transform: "rotate(-1.2deg)", boxShadow: "0 40px 80px -20px rgba(0,0,0,0.5)" }}
              >
                <div className="grid" style={{ gridTemplateColumns: "28px repeat(4,1fr)" }}>
                  <div />
                  {["Mon", "Tue", "Wed", "Thu"].map((d) => (
                    <div key={d} className="text-center text-[9px] font-bold uppercase tracking-wide text-[#8492a6] pb-1.5">{d}</div>
                  ))}
                </div>
                <div className="relative grid" style={{ gridTemplateColumns: "28px repeat(4,1fr)", height: 168 }}>
                  {/* hour lines */}
                  <div className="absolute inset-0 left-[28px]" style={{ backgroundImage: "repeating-linear-gradient(to bottom, #eef2f8 0 1px, transparent 1px 24px)" }} />
                  {/* gutter labels */}
                  <div className="flex flex-col justify-between text-[7.5px] text-[#8492a6] pr-1 text-right">
                    {["8", "10", "12", "2", "4"].map((h) => <span key={h}>{h}</span>)}
                  </div>
                  {[0, 1, 2, 3].map((col) => (
                    <div key={col} className="relative border-l border-[#e7ecf4]">
                      {HERO_EVENTS.filter((e) => e.col === col).map((e, i) => (
                        <div
                          key={i}
                          className="absolute left-[3px] right-[3px] rounded-md text-white overflow-hidden"
                          style={{
                            top: e.top,
                            height: e.h,
                            backgroundColor: e.color,
                            borderLeft: "3px solid rgba(255,255,255,0.45)",
                            boxShadow: "0 2px 6px rgba(11,27,51,0.18)",
                          }}
                        >
                          <span className="block px-1.5 pt-1 text-[8.5px] font-bold leading-none">{e.code}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHITE SECTION */}
      <section className="bg-[var(--cy-surface)] border-t border-[var(--cy-border)]">
        <div className="max-w-6xl mx-auto px-6 py-11">
          {/* how it works */}
          <div id="how" className="grid md:grid-cols-3 gap-9">
            {STEPS.map((s) => (
              <div key={s.n}>
                <span className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-lg bg-charger-blue text-charger-gold font-mono font-bold text-sm">
                  {s.n}
                </span>
                <h3 className="mt-3.5 text-[15.5px] font-bold text-[var(--cy-text)]">{s.title}</h3>
                <p className="mt-1.5 text-[13px] leading-[1.55] text-[var(--cy-text-2)]">{s.body}</p>
              </div>
            ))}
          </div>

          <div className="my-9 border-t border-[var(--cy-border)]" />

          {/* feature grid */}
          <div id="features" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-[13px] border border-[var(--cy-border)] bg-[var(--cy-surface-2)] p-[18px]">
                <h4 className="text-[14px] font-bold text-charger-blue dark:text-[var(--cy-accent)]">{f.title}</h4>
                <p className="mt-1.5 text-[12.5px] leading-[1.55] text-[var(--cy-text-2)]">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER — matches app footer */}
      <footer className="border-t border-[var(--cy-border)] bg-[var(--cy-surface)]">
        <div className="max-w-6xl mx-auto px-6 py-3 text-xs text-[var(--cy-text-3)] flex flex-wrap items-center justify-between gap-2">
          <span>Need help? Contact cypressschedulersupport@gmail.com</span>
          <div className="flex items-center gap-3">
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
            <Link href="/api/health" className="hover:underline">Status</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
