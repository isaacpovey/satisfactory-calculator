import { FactorySummaryClient } from "./summary-client";

export function generateStaticParams() {
  return [{ id: "demo" }];
}

export default function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  return <FactorySummaryClient params={params} />;
}
