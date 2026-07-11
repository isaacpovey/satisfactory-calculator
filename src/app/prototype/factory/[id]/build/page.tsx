import { redirect } from "next/navigation";

export function generateStaticParams() {
  return [{ id: "demo" }];
}

export default async function PrototypeBuildRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/factory?id=${id}&view=build`);
}
