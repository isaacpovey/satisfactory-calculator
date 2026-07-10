import { beltTierForRate } from "@/data/belts";
import { itemById } from "@/data/items";
import type { ItemId } from "@/data/types";
import {
  FlowEndpointLink,
  ItemFlowLink,
} from "@/components/planner/flow-endpoint-link";
import { SplitterPlanDisplay } from "@/components/planner/splitter-plan-display";
import { formatRate } from "@/lib/solver/format";
import type { StageInputBelt } from "@/lib/solver/types";

function formatSource(
  from: StageInputBelt["from"],
): { kind: "raw" | "stage"; id: string; label?: string } {
  if (from.kind === "raw") {
    return { kind: "raw", id: from.id };
  }
  return { kind: "stage", id: from.id };
}

interface StageInputBeltsProps {
  belts: StageInputBelt[];
  maxBeltCapacity: number;
}

export function StageInputBelts({
  belts,
  maxBeltCapacity,
}: StageInputBeltsProps) {
  if (belts.length === 0) return null;

  // Group by item for a short summary line
  const byItem = new Map<ItemId, number>();
  for (const b of belts) {
    byItem.set(b.item, (byItem.get(b.item) ?? 0) + b.rate);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Input belts
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {[...byItem.entries()]
            .map(([item, total]) => {
              const count = belts.filter((b) => b.item === item).length;
              const name = itemById[item]?.name ?? item;
              return `${name}: ${formatRate(total)}/min on ${count} belt${count === 1 ? "" : "s"}`;
            })
            .join(" · ")}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {belts.map((belt, i) => {
          const tier = beltTierForRate(belt.rate, maxBeltCapacity);
          const src = formatSource(belt.from);
          return (
            <div
              key={`${belt.item}-${i}-${belt.rate}`}
              className="flex flex-col gap-3 rounded-xl bg-muted/40 px-4 py-3.5 ring-1 ring-foreground/8"
            >
              <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-foreground/8 pb-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Belt {i + 1}
                    {tier ? ` · ${tier.name.replace("Conveyor ", "")}` : ""}
                  </p>
                  <ItemFlowLink itemId={belt.item} embedded />
                </div>
                <p className="font-heading text-base font-semibold tabular-nums">
                  {formatRate(belt.rate)}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                    /min
                  </span>
                </p>
              </header>

              <p className="text-[11px] text-muted-foreground">
                from{" "}
                <FlowEndpointLink
                  kind={src.kind}
                  id={src.id}
                  label={src.label}
                />
              </p>

              {!belt.split.mergeOnly ? (
                <SplitterPlanDisplay plan={belt.split} variant="output" />
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Entire belt to bank
                </p>
              )}

              <ul className="flex flex-col gap-1.5">
                {belt.feeds.map((feed) => (
                  <li
                    key={`${i}-bank-${feed.bankIndex}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md bg-background/70 px-2.5 py-1.5 ring-1 ring-foreground/8"
                  >
                    <span className="text-[11px] text-muted-foreground">
                      Bank {feed.bankIndex + 1}
                      <span className="ml-1.5 text-foreground/80">
                        · {feed.machines} machine
                        {feed.machines === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatRate(feed.rate)}
                      <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                        /min
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
