import { OutputMergeVisual } from "@/components/planner/belt-flow-visual";
import { ItemFlowLink } from "@/components/planner/flow-endpoint-link";
import { mergerOutputStageRates } from "@/lib/solver/group-inputs";
import { formatRate } from "@/lib/solver/format";
import type { ItemId } from "@/data/types";
import type { MergePlan } from "@/lib/solver/types";
import { cn } from "@/lib/utils";

interface MergePlanDisplayProps {
  plan: MergePlan;
  itemId: ItemId;
  laneIndex: number;
  className?: string;
}

export function MergePlanDisplay({ plan, itemId, laneIndex, className }: MergePlanDisplayProps) {
  const stages = mergerOutputStageRates(plan);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-muted/40 px-4 py-3.5 ring-1 ring-foreground/8",
        className,
      )}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-foreground/8 pb-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {plan.to?.kind === "excess"
              ? "Overflow belt"
              : plan.to
                ? `Belt to ${plan.to.id}`
                : `Output belt ${laneIndex + 1}`}
          </p>
          <ItemFlowLink itemId={itemId} embedded />
        </div>
        <p className="font-heading text-base font-semibold tabular-nums">
          {formatRate(plan.rate)}
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">/min</span>
        </p>
      </header>

      <OutputMergeVisual
        sourceRates={plan.sourceRates}
        sourceBankIndexes={plan.sourceBankIndexes}
        stages={stages}
        finalRate={plan.rate}
      />
    </div>
  );
}
