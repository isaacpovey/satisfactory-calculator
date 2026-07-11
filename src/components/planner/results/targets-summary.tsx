import { itemById } from "@/data/items";
import type { TargetResult } from "@/lib/solver/types";
import { formatRate } from "@/lib/solver/format";
import { cn } from "@/lib/utils";
import { changedRing } from "@/components/planner/results/shared";

interface TargetsSummaryProps {
  targets: TargetResult[];
  changedItems?: Set<string>;
}

export function TargetsSummary({ targets, changedItems }: TargetsSummaryProps) {
  if (targets.length === 0) {
    return <p className="text-sm text-muted-foreground">No targets selected.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {targets.map((t) => (
        <div
          key={t.item}
          id={`target-${t.item}`}
          className={cn(
            "scroll-mt-4 flex flex-col gap-2 rounded-xl bg-card/80 p-4 transition-[box-shadow,background-color] duration-300",
            changedRing(changedItems?.has(t.item) ?? false),
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="font-heading font-semibold">{itemById[t.item].name}</p>
              {changedItems?.has(t.item) ? (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  updated
                </span>
              ) : null}
            </div>
            <p className="font-heading text-xl font-bold tabular-nums text-primary">
              {formatRate(t.totalRate)}
              <span className="ml-0.5 text-xs font-medium text-muted-foreground">/min</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs tabular-nums text-muted-foreground">
            <span className="rounded-md bg-muted px-2 py-0.5">
              min {formatRate(t.plannedMinRate)}
            </span>
            {t.extraRate > 1e-6 ? (
              <span className="rounded-md bg-accent px-2 py-0.5 text-accent-foreground">
                +{formatRate(t.extraRate)} leftover
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
