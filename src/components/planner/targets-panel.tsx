"use client";

import { useState } from "react";
import { itemById, manufacturedItemIds } from "@/data/items";
import type { ItemId } from "@/data/types";
import type { TargetSpec } from "@/lib/solver/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TargetsPanelProps {
  targets: TargetSpec[];
  onChange: (targets: TargetSpec[]) => void;
}

export function TargetsPanel({ targets, onChange }: TargetsPanelProps) {
  const [addKey, setAddKey] = useState(0);
  const used = new Set(targets.map((t) => t.item));
  const available = manufacturedItemIds.filter((id) => !used.has(id));

  function update(index: number, patch: Partial<TargetSpec>) {
    onChange(targets.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function remove(index: number) {
    onChange(targets.filter((_, i) => i !== index));
  }

  function add(item: ItemId) {
    onChange([...targets, { item, minRate: 0, weight: 50 }]);
    setAddKey((k) => k + 1);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card/90 p-4 ring-1 ring-foreground/8">
      <div>
        <h2 className="font-heading text-base font-semibold">End products</h2>
        <p className="text-sm text-muted-foreground">
          Minimums, then leftover balance weight
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {targets.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Add at least one end product to plan.
          </p>
        )}
        {targets.map((target, index) => (
          <div
            key={target.item}
            className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{itemById[target.item].name}</p>
                <p className="text-xs text-muted-foreground">
                  Tier {itemById[target.item].tier}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`min-${target.item}`}>Min rate /min</Label>
              <Input
                id={`min-${target.item}`}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className="tabular-nums"
                value={target.minRate}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  update(index, {
                    minRate: Number.isFinite(n) && n >= 0 ? n : 0,
                  });
                }}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Leftover weight</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {target.weight}
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[target.weight]}
                onValueChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  update(index, {
                    weight: typeof next === "number" ? next : 0,
                  });
                }}
              />
            </div>
          </div>
        ))}

        <div className="grid gap-1.5">
          <Label>Add product</Label>
          <Select
            key={addKey}
            onValueChange={(value) => {
              if (value) add(value as ItemId);
            }}
            disabled={available.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a part…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((id) => (
                <SelectItem key={id} value={id}>
                  {itemById[id].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  );
}
