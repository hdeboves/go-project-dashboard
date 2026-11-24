import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "GO Project Hub — GamersOrigin Agency OS",
  description:
    "Cockpit de gestion multi-projets automatisé GamersOrigin (Drive 001→006, Budget, Rétroplanning, Agenda, Weeklys, Reporting)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${plusJakartaSans.variable} ${jetBrainsMono.variable} dark`}
    >
      <body className="min-h-screen bg-[#090b10] font-sans text-slate-100 antialiased selection:bg-rose-600/30 selection:text-rose-200">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
