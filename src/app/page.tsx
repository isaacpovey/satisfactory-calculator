import { Suspense } from "react";
import { PlannerApp } from "@/components/planner/planner-app";

export default function Home() {
  return (
    <main className="flex-1">
      <Suspense fallback={null}>
        <PlannerApp />
      </Suspense>
    </main>
  );
}
