import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Comptes rendus Krisp",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
