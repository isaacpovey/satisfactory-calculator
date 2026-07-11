import { redirect } from "next/navigation";

export function generateStaticParams() {
  return [{ id: "demo" }];
}

export default async function PrototypeSummaryRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/factory?id=${id}`);
}
