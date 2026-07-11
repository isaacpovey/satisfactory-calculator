"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ProductionStage, SolveResult } from "@/lib/solver/types";
import { stageProgress } from "@/lib/build-sections";
import { cn } from "@/lib/utils";

interface StageNavProps {
  result: SolveResult;
  builtSections: Set<string>;
  activeStageId: string | null;
  onStageClick: (stageId: string) => void;
}

export function StageNav({
  result,
  builtSections,
  activeStageId,
  onStageClick,
}: StageNavProps) {
  const network = result.network;
  const chains =
    network.chains.length > 1
      ? network.chains
      : [{ id: "all", label: "", stageIds: network.stages.map((s) => s.recipeId) }];

  return (
    <nav aria-label="Production stages" className="flex flex-col gap-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stages</p>
      {chains.map((chain) => {
        const chainStages = chain.stageIds
          .map((id) => network.stages.find((s) => s.recipeId === id))
          .filter((s): s is ProductionStage => s !== undefined);

        return (
          <div key={chain.id} className="flex flex-col gap-1">
            {network.chains.length > 1 && chain.label ? (
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {chain.label}
              </p>
            ) : null}
            {chainStages.map((stage) => {
              const { built, total } = stageProgress(stage, builtSections);
              const complete = total > 0 && built === total;
              const partial = built > 0 && built < total;
              const active = activeStageId === stage.recipeId;

              return (
                <button
                  key={stage.recipeId}
                  type="button"
                  onClick={() => onStageClick(stage.recipeId)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-primary/12 font-medium text-primary ring-1 ring-primary/25"
                      : "text-foreground hover:bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                      complete
                        ? "bg-util-high/20 text-util-high"
                        : partial
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {complete ? <Check className="size-3" /> : `${built}/${total}`}
                  </span>
                  <span className="min-w-0 truncate">{stage.recipeName}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/** Horizontal chip nav for narrow viewports */
export function StageNavChips({
  result,
  builtSections,
  activeStageId,
  onStageClick,
}: StageNavProps) {
  const network = result.network;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
      {network.stages.map((stage) => {
        const { built, total } = stageProgress(stage, builtSections);
        const active = activeStageId === stage.recipeId;
        return (
          <button
            key={stage.recipeId}
            type="button"
            onClick={() => onStageClick(stage.recipeId)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {stage.recipeName}
            <span className="ml-1.5 opacity-70">
              {built}/{total}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function useActiveStageScroll(stageIds: string[]): {
  activeStageId: string | null;
  scrollToStage: (stageId: string) => void;
} {
  const [activeStageId, setActiveStageId] = useState<string | null>(stageIds[0] ?? null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current?.disconnect();
    if (stageIds.length === 0) return;

    const visible = new Map<string, number>();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^stage-/, "");
          if (entry.isIntersecting) {
            visible.set(id, entry.intersectionRatio);
          } else {
            visible.delete(id);
          }
        }
        if (visible.size === 0) return;
        let bestId: string = stageIds[0] ?? "";
        let bestRatio = -1;
        for (const [id, ratio] of visible) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId) setActiveStageId(bestId);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    for (const id of stageIds) {
      const el = document.getElementById(`stage-${id}`);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [stageIds]);

  const scrollToStage = (stageId: string) => {
    const el = document.getElementById(`stage-${stageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveStageId(stageId);
    }
  };

  return { activeStageId, scrollToStage };
}
