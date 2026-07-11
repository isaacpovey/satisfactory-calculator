import { Suspense } from "react";
import FactoryPageClient from "./factory-page-client";

export default function FactoryPage() {
  return (
    <Suspense fallback={null}>
      <FactoryPageClient />
    </Suspense>
  );
}
