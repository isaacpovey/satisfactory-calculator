import { FactoryBuildClient } from "./build-client";

export function generateStaticParams() {
  return [{ id: "demo" }];
}

export default function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  return <FactoryBuildClient params={params} />;
}
