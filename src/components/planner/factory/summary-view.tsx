"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Copy, Pencil } from "lucide-react";
import { itemById } from "@/data/items";
import { Button, buttonVariants } from "@/components/ui/button";
import { ORE_SWATCH, Section, UtilMeter } from "@/components/planner/results/shared";
import { TargetsSummary } from "@/components/planner/results/targets-summary";
import { InputsSummary } from "@/components/planner/factory/inputs-summary";
import { IntermediatesSummary } from "@/components/planner/factory/intermediates-summary";
import {
  CopyFactoryDialog,
  RenameFactoryDialog,
} from "@/components/planner/factory/rename-factory-dialog";
import { formatPercent } from "@/lib/solver/format";
import { cn } from "@/lib/utils";
import type { SavedFactory } from "@/lib/factory-storage";

interface SummaryViewProps {
  factory: SavedFactory;
  onFactoryUpdate?: (factory: SavedFactory) => void;
  onViewBuild?: () => void;
}

export function SummaryView({ factory, onFactoryUpdate, onViewBuild }: SummaryViewProps) {
  const { result } = factory;
  const [renameOpen, setRenameOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
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

      <Section
        title="Intermediate items"
        hint="Production, consumption, and net balance for every manufactured part"
      >
        <IntermediatesSummary items={result.items} targets={result.targets} />
      </Section>

      <div className="flex flex-wrap gap-3 border-t border-foreground/8 pt-6">
        {onViewBuild ? (
          <Button size="lg" onClick={onViewBuild}>
            View build plan
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Link href={`/factory?id=${factory.id}&view=build`} className={buttonVariants({ size: "lg" })}>
            View build plan
            <ArrowRight className="size-4" />
          </Link>
        )}
        <Button variant="outline" size="lg" onClick={() => setRenameOpen(true)}>
          <Pencil className="size-4" />
          Rename
        </Button>
        <Button variant="outline" size="lg" onClick={() => setCopyOpen(true)}>
          <Copy className="size-4" />
          Save a copy
        </Button>
      </div>

      <RenameFactoryDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        factory={factory}
        onRenamed={onFactoryUpdate}
      />
      <CopyFactoryDialog open={copyOpen} onOpenChange={setCopyOpen} sourceFactory={factory} />
    </div>
  );
}
