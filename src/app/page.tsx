import dynamic from "next/dynamic";
import { Suspense } from "react";
import { PlannerBootstrapLoading } from "@/components/planner/planner-app";

const PlannerApp = dynamic(
  () => import("@/components/planner/planner-app").then((module) => module.PlannerApp),
  {
    ssr: false,
    loading: () => <PlannerBootstrapLoading />,
  },
);

export default function Home() {
  return (
    <main className="flex-1">
      <Suspense fallback={<PlannerBootstrapLoading />}>
        <PlannerApp />
      </Suspense>
    </main>
  );
}
