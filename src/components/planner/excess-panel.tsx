"use client";

import { useState } from "react";
import { itemById } from "@/data/items";
import type { ExcessResult } from "@/lib/solver/types";
import { formatRate } from "@/lib/solver/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ExcessPanelProps {
  excess: ExcessResult[];
  floors: Partial<Record<string, number>>;
  onFloorChange: (item: string, rate: number) => void;
  onApplyGlobalMinimum: (rate: number) => void;
}

export function ExcessPanel({
  excess,
  floors,
  onFloorChange,
  onApplyGlobalMinimum,
}: ExcessPanelProps) {
  const [globalMinimum, setGlobalMinimum] = useState("0");

  function applyGlobalMinimum() {
    const rate = Number(globalMinimum);
    if (!Number.isFinite(rate) || rate < 0) return;
    onApplyGlobalMinimum(rate);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card/90 p-4 ring-1 ring-foreground/8">
      <div>
        <h2 className="font-heading text-base font-semibold">Excess floors</h2>
        <p className="text-sm text-muted-foreground">Optional spare-part minimums</p>
      </div>

      {excess.length > 0 ? (
        <div className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="global-excess-floor" className="text-xs">
              Global minimum
            </Label>
            <Input
              id="global-excess-floor"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              className="h-8 tabular-nums"
              value={globalMinimum}
              onChange={(e) => setGlobalMinimum(e.target.value)}
            />
          </div>
          <Button type="button" size="sm" className="h-8" onClick={applyGlobalMinimum}>
            Apply to all
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {excess.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add an end product to see chain intermediaries.
          </p>
        ) : (
          excess.map((row) => {
            const floor = floors[row.item] ?? 0;
            const isActive = row.rate > 1e-6;
            return (
              <div
                key={row.item}
                className={cn(
                  "grid gap-2 rounded-lg p-3 sm:grid-cols-[1fr_5.5rem] sm:items-end",
                  isActive ? "bg-accent/60" : "bg-muted/40",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {itemById[row.item]?.name ?? row.item}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {isActive ? `${formatRate(row.rate)}/min` : "idle"}
                    {row.autoRate > 1e-6 ? ` · +${formatRate(row.autoRate)} auto` : ""}
                  </p>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`excess-floor-${row.item}`} className="text-xs">
                    Floor
                  </Label>
                  <Input
                    id={`excess-floor-${row.item}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    className="h-8 tabular-nums"
                    value={floor}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      onFloorChange(row.item, Number.isFinite(n) && n >= 0 ? n : 0);
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
