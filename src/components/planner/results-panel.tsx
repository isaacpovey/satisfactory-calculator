"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { itemById } from "@/data/items";
import { recipes as allRecipes } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import type {
  FlowEdge,
  SolveResult,
  SplitPlan,
} from "@/lib/solver/types";
import type { ResultChanges } from "@/lib/solver/diff";
import { emptyChanges } from "@/lib/solver/diff";
import { formatClock } from "@/lib/solver/constraints";
import {
  formatMachines,
  formatPercent,
  formatRate,
} from "@/lib/solver/format";
import type { AllowedClock } from "@/lib/solver/constraints";
import { cn } from "@/lib/utils";

interface ResultsPanelProps {
  result: SolveResult | null;
  computing?: boolean;
  stale?: boolean;
  changes?: ResultChanges;
}

const recipeNameById = Object.fromEntries(
  allRecipes.map((r) => [r.id, r.name]),
) as Record<string, string>;

const ORE_SWATCH: Partial<Record<ItemId, string>> = {
  "iron-ore": "bg-ore-iron",
  "copper-ore": "bg-ore-copper",
  limestone: "bg-ore-limestone",
  coal: "bg-ore-coal",
  "caterium-ore": "bg-ore-caterium",
  "raw-quartz": "bg-ore-quartz",
  sulfur: "bg-ore-sulfur",
};

function utilTone(u: number): string {
  if (u >= 0.9) return "bg-util-high";
  if (u >= 0.55) return "bg-util-mid";
  return "bg-util-low";
}

function formatSplitPlan(plan: SplitPlan): string {
  if (plan.mergeOnly) return "full belt";
  if (!plan.ratio) return "balancer";
  const ratio =
    plan.ratio.den === 1 ? "all" : `${plan.ratio.num}/${plan.ratio.den}`;
  if (plan.steps.length === 0) return ratio;
  return `${ratio} · ${plan.steps.join(" → ")}`;
}

function formatEndpoint(kind: string, id: string): string {
  if (kind === "raw" || kind === "target" || kind === "excess") {
    const name = itemById[id as keyof typeof itemById]?.name ?? id;
    if (kind === "target") return `Target · ${name}`;
    if (kind === "excess") return `Excess · ${name}`;
    return name;
  }
  if (kind === "recipe" || kind === "stage") {
    return recipeNameById[id] ?? id;
  }
  return id;
}

function changedRing(changed: boolean): string {
  return changed
    ? "ring-2 ring-primary/55 bg-primary/[0.06] shadow-[0_0_0_1px_oklch(0.5_0.14_42/0.2)]"
    : "ring-1 ring-foreground/8";
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {hint ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function UtilMeter({
  name,
  used,
  available,
  utilization,
  leftover,
  swatch,
  changed,
}: {
  name: string;
  used: number;
  available: number;
  utilization: number;
  leftover: number;
  swatch?: string;
  changed?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, utilization * 100));
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl bg-card/80 p-3 transition-[box-shadow,background-color] duration-300",
        changedRing(!!changed),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              swatch ?? "bg-primary",
            )}
            aria-hidden
          />
          <span className="truncate font-medium">{name}</span>
          {changed ? (
            <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              updated
            </span>
          ) : null}
        </div>
        <span className="shrink-0 font-heading text-sm font-semibold tabular-nums">
          {formatPercent(utilization)}
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${name} utilization`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            utilTone(utilization),
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {formatRate(used)} / {formatRate(available)}
        {leftover > 1e-6 ? ` · ${formatRate(leftover)} left` : ""}
      </p>
    </div>
  );
}

function FlowChip({ edge }: { edge: FlowEdge }) {
  const kindTone =
    edge.to.kind === "target"
      ? "bg-primary/12 text-primary ring-primary/20"
      : edge.to.kind === "excess"
        ? "bg-accent text-accent-foreground ring-accent-foreground/15"
        : "bg-secondary text-secondary-foreground ring-foreground/8";

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg px-3 py-2 ring-1",
        kindTone,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium">
          {formatEndpoint(edge.to.kind, edge.to.id)}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {formatRate(edge.rate)}/min
        </span>
      </div>
      <p className="text-xs opacity-80">
        {itemById[edge.item]?.name ?? edge.item}
        {" · "}
        {formatSplitPlan(edge.outputSplit)}
      </p>
    </div>
  );
}

export function ResultsPanel({
  result,
  computing = false,
  stale = false,
  changes = emptyChanges(),
}: ResultsPanelProps) {
  if (!result) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl bg-card/70 p-8 text-center ring-1 ring-foreground/8">
        {computing ? (
          <>
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="font-heading font-semibold">Computing plan…</p>
            <p className="text-sm text-muted-foreground">
              Building machine banks and splitter shares
            </p>
          </>
        ) : (
          <>
            <p className="font-heading font-semibold">No plan yet</p>
            <p className="text-sm text-muted-foreground">
              Adjust inputs on the left, then press Compute plan
            </p>
          </>
        )}
      </div>
    );
  }

  const shortfalls = result.raws.filter((r) => r.shortfall > 1e-6);
  const network = result.network;
  const activeExcess = result.excess.filter((e) => e.rate > 1e-6);
  const rawEdges = network.edges.filter((e) => e.from.kind === "raw");
  const dimmed = computing || stale;

  return (
    <div className="relative">
      {computing ? (
        <div
          className="absolute inset-0 z-20 flex items-start justify-center rounded-xl bg-background/55 pt-24 backdrop-blur-[2px]"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="flex items-center gap-3 rounded-xl bg-card px-5 py-3 shadow-lg ring-1 ring-primary/25">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div>
              <p className="font-heading text-sm font-semibold">Computing…</p>
              <p className="text-xs text-muted-foreground">
                Previous results stay visible until done
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {stale && !computing ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-primary/10 px-4 py-2.5 text-sm ring-1 ring-primary/25">
          <p className="font-medium text-primary">
            Inputs changed — results are stale
          </p>
          <p className="text-xs text-muted-foreground">Press Compute plan</p>
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-col gap-8 transition-opacity duration-200",
          dimmed && "pointer-events-none opacity-45",
        )}
      >
        {!result.feasible && (
          <div
            role="alert"
            className="rounded-xl bg-destructive/10 px-4 py-3 text-sm ring-1 ring-destructive/30"
          >
            <p className="font-heading font-semibold text-destructive">
              Minimums exceed available ore
            </p>
            <ul className="mt-2 space-y-1 text-destructive/90">
              {shortfalls.map((r) => (
                <li key={r.item} className="tabular-nums">
                  {itemById[r.item].name}: need{" "}
                  {formatRate(r.available + r.shortfall)}/min, have{" "}
                  {formatRate(r.available)}/min
                </li>
              ))}
            </ul>
          </div>
        )}

        <Section
          title="Ore utilization"
          hint="How much of each node is spoken for"
          action={
            <span
              className={cn(
                "rounded-full px-3 py-1 font-heading text-sm font-semibold tabular-nums transition-colors",
                changes.overall && "ring-2 ring-primary/50",
                result.feasible
                  ? "bg-util-high/15 text-util-high"
                  : "bg-destructive/15 text-destructive",
              )}
            >
              {formatPercent(result.overallUtilization)} overall
            </span>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {result.raws.map((r) => (
              <UtilMeter
                key={r.item}
                name={itemById[r.item].name}
                used={r.used}
                available={r.available}
                utilization={r.utilization}
                leftover={r.leftover}
                swatch={ORE_SWATCH[r.item]}
                changed={changes.raws.has(r.item)}
              />
            ))}
          </div>
        </Section>

        <Section title="Targets" hint="Planned output after minima and balance">
          {result.targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No targets selected.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {result.targets.map((t) => (
                <div
                  key={t.item}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl bg-card/80 p-4 transition-[box-shadow,background-color] duration-300",
                    changedRing(changes.targets.has(t.item)),
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className="font-heading font-semibold">
                        {itemById[t.item].name}
                      </p>
                      {changes.targets.has(t.item) ? (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          updated
                        </span>
                      ) : null}
                    </div>
                    <p className="font-heading text-xl font-bold tabular-nums text-primary">
                      {formatRate(t.totalRate)}
                      <span className="ml-0.5 text-xs font-medium text-muted-foreground">
                        /min
                      </span>
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
          )}
        </Section>

        <Section
          title="Production stages"
          hint="Machine banks and where each belt goes"
        >
          {network.stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No production required yet.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {network.stages.map((stage) => {
                const outgoing = network.edges.filter(
                  (e) =>
                    e.from.kind === "stage" && e.from.id === stage.recipeId,
                );
                const stageChanged = changes.stages.has(stage.recipeId);
                return (
                  <article
                    key={stage.recipeId}
                    className={cn(
                      "overflow-hidden rounded-xl bg-card/90 transition-[box-shadow] duration-300",
                      changedRing(stageChanged),
                    )}
                  >
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 bg-gradient-to-r from-primary/12 via-secondary/50 to-accent/25 px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-heading text-base font-semibold">
                            {stage.recipeName}
                          </h3>
                          {stageChanged ? (
                            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              updated
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {stage.building}
                          {" · "}
                          {itemById[stage.primaryOutput]?.name ??
                            stage.primaryOutput}
                        </p>
                      </div>
                      <p className="font-heading text-lg font-bold tabular-nums text-primary">
                        {formatRate(stage.outputPerMinute)}
                        <span className="ml-0.5 text-xs font-medium text-muted-foreground">
                          /min
                        </span>
                      </p>
                    </header>

                    <div className="flex flex-col gap-4 p-4">
                      <div className="flex flex-wrap gap-2">
                        {stage.groups.map((g, i) => (
                          <div
                            key={`${stage.recipeId}-g-${i}`}
                            className="flex flex-col gap-0.5 rounded-lg bg-muted/80 px-3 py-2"
                          >
                            <p className="font-heading text-sm font-semibold tabular-nums">
                              {formatMachines(g.machines)}
                              <span className="mx-1 text-muted-foreground">
                                @
                              </span>
                              {formatClock(g.clock as AllowedClock)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              feed {formatSplitPlan(g.inputSplit)}
                            </p>
                          </div>
                        ))}
                      </div>

                      {outgoing.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Outputs
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {outgoing.map((edge, i) => (
                              <FlowChip
                                key={`${edge.item}-${edge.to.kind}-${edge.to.id}-${i}`}
                                edge={edge}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Section>

        {rawEdges.length > 0 ? (
          <details className="group rounded-xl bg-card/70 ring-1 ring-foreground/8 open:bg-card/90">
            <summary className="cursor-pointer list-none px-4 py-3 font-heading text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-2">
                Raw feeds
                <span className="text-xs font-normal text-muted-foreground">
                  {rawEdges.length} belts · ore into first stages
                </span>
              </span>
            </summary>
            <div className="grid gap-2 border-t border-foreground/6 px-4 py-3 sm:grid-cols-2">
              {rawEdges.map((edge, i) => (
                <div
                  key={`raw-${edge.item}-${edge.to.id}-${i}`}
                  className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5"
                >
                  <span
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      ORE_SWATCH[edge.item] ?? "bg-primary",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {itemById[edge.item]?.name ?? edge.item}
                      <span className="mx-1.5 text-muted-foreground">→</span>
                      {formatEndpoint(edge.to.kind, edge.to.id)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatSplitPlan(edge.outputSplit)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatRate(edge.rate)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {activeExcess.length > 0 ? (
          <details className="group rounded-xl bg-accent/40 ring-1 ring-accent-foreground/10 open:bg-accent/55">
            <summary className="cursor-pointer list-none px-4 py-3 font-heading text-sm font-semibold [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-2">
                Spare parts
                <span className="text-xs font-normal text-muted-foreground">
                  {activeExcess.length} soaking leftover ore
                </span>
              </span>
            </summary>
            <div className="flex flex-wrap gap-2 border-t border-accent-foreground/10 px-4 py-3">
              {activeExcess.map((e) => (
                <div
                  key={e.item}
                  className={cn(
                    "rounded-lg bg-card/80 px-3 py-2 transition-[box-shadow] duration-300",
                    changes.excess.has(e.item)
                      ? "ring-2 ring-primary/50"
                      : "ring-1 ring-foreground/6",
                  )}
                >
                  <p className="text-sm font-medium">
                    {itemById[e.item]?.name ?? e.item}
                    {changes.excess.has(e.item) ? (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase text-primary">
                        updated
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatRate(e.rate)}/min
                    {e.autoRate > 1e-6
                      ? ` · auto +${formatRate(e.autoRate)}`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <details className="group rounded-xl bg-card/60 ring-1 ring-foreground/8 open:bg-card/90">
          <summary className="cursor-pointer list-none px-4 py-3 font-heading text-sm font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-center justify-between gap-2">
              Item balance
              <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                produced vs consumed
              </span>
            </span>
          </summary>
          <div className="border-t border-foreground/6 px-4 py-3">
            {result.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No item flow yet.</p>
            ) : (
              <ul className="divide-y divide-foreground/6">
                {result.items.map((row) => (
                  <li
                    key={row.item}
                    className={cn(
                      "flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm",
                      changes.items.has(row.item) &&
                        "rounded-md bg-primary/[0.06] px-2 -mx-2",
                    )}
                  >
                    <span className="font-medium">
                      {itemById[row.item]?.name ?? row.item}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      +{formatRate(row.produced)}
                      <span className="mx-1 opacity-50">/</span>−
                      {formatRate(row.consumed)}
                      <span className="ml-2 font-medium text-foreground">
                        net {formatRate(row.net)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
