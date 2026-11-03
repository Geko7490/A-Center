import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vex AI Center — Local AI Platform",
  description: "Download, manage and run local AI models. Offline-first AI workspace with projects, GitHub, Roblox and plugins.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
