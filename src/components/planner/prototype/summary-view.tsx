"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Save } from "lucide-react";
import { itemById } from "@/data/items";
import { Button, buttonVariants } from "@/components/ui/button";
import { ORE_SWATCH, Section, UtilMeter } from "@/components/planner/results/shared";
import { TargetsSummary } from "@/components/planner/results/targets-summary";
import { InputsSummary } from "@/components/planner/prototype/inputs-summary";
import { SaveFactoryDialog } from "@/components/planner/prototype/save-factory-dialog";
import { formatPercent } from "@/lib/solver/format";
import { cn } from "@/lib/utils";
import type { SavedFactory } from "@/lib/factory-storage";

interface SummaryViewProps {
  factory: SavedFactory;
}

export function SummaryView({ factory }: SummaryViewProps) {
  const { result } = factory;
  const [saveOpen, setSaveOpen] = useState(false);
  const activeExcess = result.excess.filter((e) => e.rate > 1e-6);
  const shortfalls = result.raws.filter((r) => r.shortfall > 1e-6);

  return (
    <div className="flex flex-col gap-8">
      {result.proofStatus === "OPTIMAL" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-util-high/10 px-4 py-3 text-sm ring-1 ring-util-high/25">
          <p className="font-heading font-semibold text-util-high">Globally optimal plan</p>
          <p className="text-xs text-muted-foreground">
            {result.objective?.physicalMachines ?? 0} machines ·{" "}
            {result.objective?.groups ?? 0} groups · {result.network.stages.length} stages
          </p>
        </div>
      ) : null}

      {!result.feasible && shortfalls.length > 0 ? (
        <div
          role="alert"
          className="rounded-xl bg-destructive/10 px-4 py-3 text-sm ring-1 ring-destructive/30"
        >
          <p className="font-heading font-semibold text-destructive">
            Minimums exceed available ore
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-card/80 p-4 ring-1 ring-foreground/8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Machines
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
            {result.objective?.physicalMachines ?? 0}
          </p>
        </div>
        <div className="rounded-xl bg-card/80 p-4 ring-1 ring-foreground/8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Stages
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
            {result.network.stages.length}
          </p>
        </div>
        <div className="rounded-xl bg-card/80 p-4 ring-1 ring-foreground/8">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Spare parts
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{activeExcess.length}</p>
        </div>
      </div>

      <Section
        title="Ore utilization"
        hint="How much of each node is spoken for"
        action={
          <span
            className={cn(
              "rounded-full px-3 py-1 font-heading text-sm font-semibold tabular-nums",
              result.feasible
                ? "bg-util-high/15 text-util-high"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {formatPercent(result.overallUtilization)} overall
          </span>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {result.raws.map((r) => (
            <UtilMeter
              key={r.item}
              name={itemById[r.item].name}
              used={r.used}
              available={r.available}
              utilization={r.utilization}
              leftover={r.leftover}
              swatch={ORE_SWATCH[r.item]}
            />
          ))}
        </div>
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Total outputs" hint="Planned production after minima and balance">
          <TargetsSummary targets={result.targets} />
        </Section>
        <Section title="Total inputs" hint="Raw ore consumed by this plan">
          <InputsSummary raws={result.raws} />
        </Section>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-foreground/8 pt-6">
        <Link
          href={`/prototype/factory/${factory.id}/build`}
          className={buttonVariants({ size: "lg" })}
        >
          View build plan
          <ArrowRight className="size-4" />
        </Link>
        <Button variant="outline" size="lg" onClick={() => setSaveOpen(true)}>
          <Save className="size-4" />
          Save as factory
        </Button>
      </div>

      <SaveFactoryDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        sourceFactory={factory}
        defaultName={factory.id === "demo" ? "My factory" : `${factory.name} (copy)`}
      />
    </div>
  );
}
