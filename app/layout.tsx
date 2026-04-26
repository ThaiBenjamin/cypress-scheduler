import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./Providers";

export const metadata: Metadata = {
  title: "Cypress Scheduler",
  description: "Course scheduling app for Cypress College",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>
          <div className="flex-1">{children}</div>
          <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
            <div className="max-w-6xl mx-auto px-4 py-3 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-center justify-between gap-2">
              <span>Need help? Contact cypressschedulersupport@gmail.com</span>
              <div className="flex items-center gap-3">
                <Link href="/privacy" className="hover:underline">Privacy</Link>
                <Link href="/terms" className="hover:underline">Terms</Link>
                <Link href="/api/health" className="hover:underline">Status</Link>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
