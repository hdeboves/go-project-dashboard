import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vue d'ensemble (Tous les projets)",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
