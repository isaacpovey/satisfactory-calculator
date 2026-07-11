import type { ReactNode } from "react";
import type { FactoryNetwork, ProductionStage } from "@/lib/solver/types";
import { formatRate } from "@/lib/solver/format";
import { cn } from "@/lib/utils";
import { ItemFlowLink } from "@/components/planner/flow-endpoint-link";
import { MergePlanDisplay } from "@/components/planner/merge-plan-display";
import { MachineGroupCard } from "@/components/planner/machine-group-card";
import { DownstreamLanes } from "@/components/planner/downstream-lanes";
import { StageInputBelts } from "@/components/planner/stage-input-belts";
import { changedRing } from "@/components/planner/results/shared";

interface StageCardProps {
  stage: ProductionStage;
  network: FactoryNetwork;
  stageChanged?: boolean;
  maxBeltCapacity: number;
  /** Optional wrapper for each build subsection (inputs, banks, merges) */
  renderSection?: (sectionId: string, label: string, children: ReactNode) => ReactNode;
}

export function StageCard({
  stage,
  network,
  stageChanged = false,
  maxBeltCapacity,
  renderSection,
}: StageCardProps) {
  const outgoing = network.edges.filter(
    (e) => e.from.kind === "stage" && e.from.id === stage.recipeId,
  );

  const wrapSection = renderSection ?? ((_id, _label, children) => children);

  return (
    <article
      id={`stage-${stage.recipeId}`}
      className={cn(
        "scroll-mt-4 overflow-hidden rounded-xl bg-card/90 transition-[box-shadow] duration-300",
        changedRing(stageChanged),
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 bg-gradient-to-r from-primary/12 via-secondary/50 to-accent/25 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-heading text-base font-semibold">{stage.recipeName}</h3>
            {stageChanged ? (
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                updated
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {stage.building}
            {" · "}
            <ItemFlowLink itemId={stage.primaryOutput} />
          </p>
        </div>
        <p className="font-heading text-lg font-bold tabular-nums text-primary">
          {formatRate(stage.outputPerMinute)}
          <span className="ml-0.5 text-xs font-medium text-muted-foreground">/min</span>
        </p>
      </header>

      <div className="flex flex-col gap-6 p-4 sm:p-5">
        {stage.inputBelts.length > 0
          ? wrapSection(
              `${stage.recipeId}:inputs`,
              "Input belts",
              <StageInputBelts belts={stage.inputBelts} maxBeltCapacity={maxBeltCapacity} />,
            )
          : null}

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Machine banks
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              In-bank splitter manifold after the input belt arrives
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {stage.groups.map((g, i) =>
              wrapSection(
                `${stage.recipeId}:bank:${i}`,
                `Bank ${i + 1}`,
                <MachineGroupCard
                  key={`${stage.recipeId}-g-${i}`}
                  recipeId={stage.recipeId}
                  group={g}
                  bankIndex={i}
                  inputBelts={stage.inputBelts}
                  maxBeltCapacity={maxBeltCapacity}
                />,
              ),
            )}
          </div>
        </div>

        {stage.outputMerges.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Output belts
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                One belt per selected bank; shared lanes use demand-balanced backpressure
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {stage.outputMerges.map((merge, i) =>
                wrapSection(
                  `${stage.recipeId}:merge:${i}`,
                  `Output merge ${i + 1}`,
                  <MergePlanDisplay
                    key={`${stage.recipeId}-merge-${i}`}
                    plan={merge}
                    itemId={stage.primaryOutput}
                    laneIndex={i}
                  />,
                ),
              )}
            </div>
          </div>
        ) : null}

        {outgoing.length > 0 || stage.outputMerges.length > 0 ? (
          <DownstreamLanes
            itemId={stage.primaryOutput}
            lanes={stage.outputMerges}
            edges={outgoing}
          />
        ) : null}
      </div>
    </article>
  );
}
