import { itemById } from "@/data/items";
import type { ItemId } from "@/data/types";
import { recipeDepth } from "@/lib/solver/constraints";
import { formatRate } from "@/lib/solver/format";
import type { ItemFlow, TargetResult } from "@/lib/solver/types";

interface IntermediatesSummaryProps {
  items: ItemFlow[];
  targets: TargetResult[];
}

function compareIntermediateItems(a: ItemId, b: ItemId): number {
  const depthDiff = recipeDepth(a) - recipeDepth(b);
  if (depthDiff !== 0) return depthDiff;
  return (itemById[a]?.name ?? a).localeCompare(itemById[b]?.name ?? b);
}

export function IntermediatesSummary({ items, targets }: IntermediatesSummaryProps) {
  const targetIds = new Set(targets.map((target) => target.item));
  const intermediates = items
    .filter((row) => {
      const item = itemById[row.item];
      if (!item?.isRaw && !targetIds.has(row.item)) {
        return row.produced > 1e-6 || row.consumed > 1e-6;
      }
      return false;
    })
    .toSorted((a, b) => compareIntermediateItems(a.item, b.item));

  if (intermediates.length === 0) {
    return <p className="text-sm text-muted-foreground">No intermediate items in this plan.</p>;
  }

  return (
    <div className="rounded-xl bg-card/80 ring-1 ring-foreground/8">
      <div className="hidden border-b border-foreground/6 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_5.5rem_5.5rem_5.5rem] sm:gap-3">
        <span>Item</span>
        <span className="text-right">Produced</span>
        <span className="text-right">Consumed</span>
        <span className="text-right">Net</span>
      </div>
      <ul className="divide-y divide-foreground/6">
        {intermediates.map((row) => (
          <li
            key={row.item}
            className="grid gap-1 px-4 py-2.5 sm:grid-cols-[1fr_5.5rem_5.5rem_5.5rem] sm:items-baseline sm:gap-3"
          >
            <span className="truncate text-sm font-medium">{itemById[row.item]?.name ?? row.item}</span>
            <span className="text-sm tabular-nums text-muted-foreground sm:text-right">
              <span className="mr-2 text-xs uppercase tracking-wide text-muted-foreground sm:hidden">
                Produced
              </span>
              +{formatRate(row.produced)}
            </span>
            <span className="text-sm tabular-nums text-muted-foreground sm:text-right">
              <span className="mr-2 text-xs uppercase tracking-wide text-muted-foreground sm:hidden">
                Consumed
              </span>
              −{formatRate(row.consumed)}
            </span>
            <span className="text-sm font-semibold tabular-nums sm:text-right">
              <span className="mr-2 text-xs font-normal uppercase tracking-wide text-muted-foreground sm:hidden">
                Net
              </span>
              {formatRate(row.net)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
