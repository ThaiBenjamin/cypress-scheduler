import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./Providers"; // <-- 1. Import the Providers wrapper

export const metadata: Metadata = {
  title: "Cypress Scheduler", // Might as well update the title while we are here!
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
        <Providers>{children}</Providers> {/* <-- 2. Wrap the app's children */}
      </body>
    </html>
  );
}
