import { itemById } from "@/data/items";
import type { RawUtilization } from "@/lib/solver/types";
import { formatRate } from "@/lib/solver/format";
import { ORE_SWATCH } from "@/components/planner/results/shared";
import { cn } from "@/lib/utils";

interface InputsSummaryProps {
  raws: RawUtilization[];
}

export function InputsSummary({ raws }: InputsSummaryProps) {
  const active = raws.filter((r) => r.used > 1e-6);

  if (active.length === 0) {
    return <p className="text-sm text-muted-foreground">No raw ore consumed.</p>;
  }

  const totalUsed = active.reduce((sum, r) => sum + r.used, 0);

  return (
    <div className="rounded-xl bg-card/80 p-4 ring-1 ring-foreground/8">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-semibold">Total raw inputs</p>
        <p className="font-heading text-xl font-bold tabular-nums text-primary">
          {formatRate(totalUsed)}
          <span className="ml-0.5 text-xs font-medium text-muted-foreground">/min</span>
        </p>
      </div>
      <ul className="divide-y divide-foreground/6">
        {active.map((r) => (
          <li key={r.item} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn("size-2.5 shrink-0 rounded-full", ORE_SWATCH[r.item] ?? "bg-primary")}
                aria-hidden
              />
              <span className="truncate text-sm font-medium">{itemById[r.item].name}</span>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatRate(r.used)}/min
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
