import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FirstCall — facilities triage desk",
  description: "AI triage for multi-site facilities operations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <strong>FirstCall</strong>
          <span className="muted">facilities triage desk</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
