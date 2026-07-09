"use client";

import { itemById } from "@/data/items";
import type { ExcessResult } from "@/lib/solver/types";
import { formatRate } from "@/lib/solver/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ExcessPanelProps {
  /** Solver-computed excess rows for the current chain */
  excess: ExcessResult[];
  /** User floor overrides (items/min) */
  floors: Partial<Record<string, number>>;
  onFloorChange: (item: string, rate: number) => void;
}

export function ExcessPanel({ excess, floors, onFloorChange }: ExcessPanelProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Excess intermediaries</CardTitle>
        <CardDescription>
          Auto-filled from the production chain. Set a floor to keep spare
          parts; the planner may raise rates further to soak leftover ore
          (preferring more complex parts).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-4">
        {excess.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add an end product to see chain intermediaries.
          </p>
        ) : (
          excess.map((row) => {
            const floor = floors[row.item] ?? 0;
            return (
              <div
                key={row.item}
                className="grid gap-2 rounded-lg border border-border/80 bg-muted/30 p-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end"
              >
                <div>
                  <p className="text-sm font-medium">
                    {itemById[row.item]?.name ?? row.item}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Planned {formatRate(row.rate)}/min
                    {row.autoRate > 1e-6
                      ? ` · auto +${formatRate(row.autoRate)}`
                      : ""}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`excess-floor-${row.item}`}>Floor</Label>
                  <Input
                    id={`excess-floor-${row.item}`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={floor}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      onFloorChange(
                        row.item,
                        Number.isFinite(n) && n >= 0 ? n : 0,
                      );
                    }}
                  />
                </div>
                <div className="flex sm:justify-end sm:pb-1">
                  {row.rate > 1e-6 ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Idle</Badge>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
