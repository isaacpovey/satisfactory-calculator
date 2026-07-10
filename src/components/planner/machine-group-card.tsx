import { beltTierForRate } from "@/data/belts";
import type { ItemId } from "@/data/types";
import { InputSplitVisual } from "@/components/planner/belt-flow-visual";
import { ItemFlowLink } from "@/components/planner/flow-endpoint-link";
import { formatClock, type AllowedClock } from "@/lib/solver/constraints";
import {
  groupInputRates,
  splitterInputStageRates,
} from "@/lib/solver/group-inputs";
import { formatMachines, formatRate } from "@/lib/solver/format";
import type { MachineGroupPlan, StageInputBelt } from "@/lib/solver/types";

interface MachineGroupCardProps {
  recipeId: string;
  group: MachineGroupPlan;
  bankIndex: number;
  inputBelts: StageInputBelt[];
  maxBeltCapacity?: number;
}

export function MachineGroupCard({
  recipeId,
  group,
  bankIndex,
  inputBelts,
  maxBeltCapacity = 270,
}: MachineGroupCardProps) {
  const inputs = groupInputRates(recipeId, group);
  const outTier = beltTierForRate(group.outputPerMinute, maxBeltCapacity);
  const feedingBelts = inputBelts
    .map((belt, beltIndex) => ({
      belt,
      beltIndex,
      feed: belt.feeds.find((f) => f.bankIndex === bankIndex),
    }))
    .filter((row) => row.feed);

  return (
    <div className="flex w-full flex-col gap-4 rounded-xl bg-muted/40 px-4 py-3.5 ring-1 ring-foreground/8">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-foreground/8 pb-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Bank {bankIndex + 1}
          </p>
          <p className="font-heading text-base font-semibold tabular-nums">
            {formatMachines(group.machines)}
            <span className="mx-1.5 text-muted-foreground">@</span>
            {formatClock(group.clock as AllowedClock)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <p className="text-[11px] text-muted-foreground">
            Output
            {outTier ? ` · ${outTier.name.replace("Conveyor ", "")}` : ""}
          </p>
          <p className="font-heading text-base font-semibold tabular-nums">
            {formatRate(group.outputPerMinute)}
            <span className="ml-0.5 text-xs font-normal text-muted-foreground">
              /min
            </span>
          </p>
        </div>
      </header>

      {feedingBelts.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Fed by input belt
          {feedingBelts.length === 1 ? "" : "s"}{" "}
          {feedingBelts.map((row) => row.beltIndex + 1).join(", ")}
        </p>
      ) : null}

      {inputs.length > 0 ? (
        <div className="flex flex-col gap-4">
          {inputs.map((input) => {
            const stages = splitterInputStageRates(
              input.totalRate,
              group.inputSplit,
            );
            return (
              <div key={input.item} className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[11px] text-muted-foreground">
                    Manifold
                  </span>
                  <ItemFlowLink itemId={input.item as ItemId} embedded />
                </div>
                <InputSplitVisual
                  stages={stages}
                  machines={group.machines}
                  perMachineRate={input.perMachineRate}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
