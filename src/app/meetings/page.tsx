import { Suspense } from "react";
import { MeetingsWorkspace } from "@/components/meetings/MeetingsWorkspace";

export default function MeetingsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl py-12 text-center text-sm text-slate-500">
          Chargement des comptes rendus Krisp...
        </div>
      }
    >
      <MeetingsWorkspace />
    </Suspense>
  );
}
