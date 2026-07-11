"use client";

import { useCallback, useMemo, useState } from "react";
import type { ProductionStage } from "@/lib/solver/types";
import { StageCard } from "@/components/planner/results/stage-card";
import { BuildSectionCheckbox } from "@/components/planner/factory/build-section-checkbox";
import {
  StageNav,
  StageNavChips,
  useActiveStageScroll,
} from "@/components/planner/factory/stage-nav";
import { toggleBuiltSection, type SavedFactory } from "@/lib/factory-storage";
import { formatClock } from "@/lib/solver/constraints";
import { formatMachines } from "@/lib/solver/format";

interface BuildViewProps {
  factory: SavedFactory;
  onFactoryUpdate: (factory: SavedFactory) => void;
}

function bankLabel(
  stage: ProductionStage,
  bankIndex: number,
): string {
  const group = stage.groups[bankIndex];
  if (!group) return `Bank ${bankIndex + 1}`;
  return `Bank ${bankIndex + 1} · ${formatMachines(group.machines)} @ ${formatClock(group.clock)}`;
}

export function BuildView({ factory, onFactoryUpdate }: BuildViewProps) {
  const { result } = factory;
  const [builtSections, setBuiltSections] = useState<Set<string>>(
    () => new Set(factory.builtSections),
  );

  const stageIds = useMemo(
    () => result.network.stages.map((s) => s.recipeId),
    [result.network.stages],
  );
  const { activeStageId, scrollToStage } = useActiveStageScroll(stageIds);

  const handleToggle = useCallback(
    (sectionId: string, checked: boolean) => {
      const updated = toggleBuiltSection(factory.id, sectionId, checked);
      if (updated) {
        setBuiltSections(new Set(updated.builtSections));
        onFactoryUpdate(updated);
      }
    },
    [factory.id, onFactoryUpdate],
  );

  const network = result.network;
  const chains =
    network.chains.length > 1
      ? network.chains
      : [{ id: "all", label: "", stageIds: network.stages.map((s) => s.recipeId) }];

  return (
    <div className="flex flex-col gap-4">
      <StageNavChips
        result={result}
        builtSections={builtSections}
        activeStageId={activeStageId}
        onStageClick={scrollToStage}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(14rem,16rem)_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:block lg:sticky lg:top-6 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:rounded-xl lg:bg-card/70 lg:p-4 lg:ring-1 lg:ring-foreground/8">
          <StageNav
            result={result}
            builtSections={builtSections}
            activeStageId={activeStageId}
            onStageClick={scrollToStage}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {chains.map((chain) => {
            const chainStages = chain.stageIds
              .map((id) => network.stages.find((s) => s.recipeId === id))
              .filter((s): s is ProductionStage => s !== undefined);

            return (
              <div key={chain.id} className="flex flex-col gap-4">
                {network.chains.length > 1 && chain.label ? (
                  <h2 className="font-heading text-sm font-semibold text-muted-foreground">
                    {chain.label}
                  </h2>
                ) : null}
                {chainStages.map((stage) => (
                  <StageCard
                    key={stage.recipeId}
                    stage={stage}
                    network={network}
                    maxBeltCapacity={result.maxBeltCapacity}
                    renderSection={(sectionId, label, children) => {
                      const displayLabel =
                        sectionId.endsWith(":inputs")
                          ? "Input belts"
                          : sectionId.includes(":bank:")
                            ? bankLabel(stage, Number(sectionId.split(":").pop()))
                            : label;

                      return (
                        <BuildSectionCheckbox
                          key={sectionId}
                          sectionId={sectionId}
                          label={displayLabel}
                          checked={builtSections.has(sectionId)}
                          onCheckedChange={(checked) => handleToggle(sectionId, checked)}
                        >
                          {children}
                        </BuildSectionCheckbox>
                      );
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
