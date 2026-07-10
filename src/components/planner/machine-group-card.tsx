import type { ItemId } from "@/data/types";
import { ItemFlowLink } from "@/components/planner/flow-endpoint-link";
import { SplitterPlanDisplay } from "@/components/planner/splitter-plan-display";
import { formatClock, type AllowedClock } from "@/lib/solver/constraints";
import {
  groupInputRates,
  splitterInputStageRates,
  type SplitterStageRate,
} from "@/lib/solver/group-inputs";
import { formatMachines, formatRate } from "@/lib/solver/format";
import type { MachineGroupPlan } from "@/lib/solver/types";

function SplitterBeltRates({ stages }: { stages: SplitterStageRate[] }) {
  if (stages.length <= 1) return null;

  return (
    <ul className="mt-1 space-y-0.5 border-l border-foreground/10 pl-2.5">
      {stages.map((stage, i) => (
        <li
          key={`${stage.label}-${i}`}
          className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px]"
        >
          <span className="text-muted-foreground">{stage.label}</span>
          <span className="font-medium tabular-nums">
            {formatRate(stage.rate)}
            <span className="ml-0.5 font-normal text-muted-foreground">/min</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

interface MachineGroupCardProps {
  recipeId: string;
  group: MachineGroupPlan;
}

export function MachineGroupCard({ recipeId, group }: MachineGroupCardProps) {
  const inputs = groupInputRates(recipeId, group);
  const showSplitterStages =
    !group.inputSplit.mergeOnly && group.inputSplit.steps.length > 0;

  return (
    <div className="flex min-w-[14rem] flex-col gap-2 rounded-lg bg-muted/80 px-3 py-2.5">
      <p className="font-heading text-sm font-semibold tabular-nums">
        {formatMachines(group.machines)}
        <span className="mx-1 text-muted-foreground">@</span>
        {formatClock(group.clock as AllowedClock)}
      </p>

      {inputs.length > 0 ? (
        <div className="flex flex-col gap-2">
          {inputs.map((input) => {
            const stages = splitterInputStageRates(
              input.totalRate,
              group.inputSplit,
            );
            return (
              <div key={input.item} className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
                  <ItemFlowLink itemId={input.item as ItemId} embedded />
                  <span className="tabular-nums text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {formatRate(input.totalRate)}
                    </span>
                    /min total
                  </span>
                </div>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {formatRate(input.perMachineRate)}/min per machine
                </p>
                {showSplitterStages ? (
                  <SplitterBeltRates stages={stages} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <SplitterPlanDisplay plan={group.inputSplit} variant="input" />
    </div>
  );
}
