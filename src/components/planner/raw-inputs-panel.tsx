"use client";

import { itemById, scarceRawIds } from "@/data/items";
import type { ItemId } from "@/data/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface RawInputsPanelProps {
  values: Partial<Record<ItemId, number>>;
  onChange: (item: ItemId, value: number) => void;
}

const ORE_SWATCH: Partial<Record<ItemId, string>> = {
  "iron-ore": "bg-ore-iron",
  "copper-ore": "bg-ore-copper",
  limestone: "bg-ore-limestone",
  coal: "bg-ore-coal",
  "caterium-ore": "bg-ore-caterium",
  "raw-quartz": "bg-ore-quartz",
  sulfur: "bg-ore-sulfur",
};

export function RawInputsPanel({ values, onChange }: RawInputsPanelProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card/90 p-4 ring-1 ring-foreground/8">
      <div>
        <h2 className="font-heading text-base font-semibold">Raw inputs</h2>
        <p className="text-sm text-muted-foreground">Ore rates from your nodes</p>
      </div>
      <div className="grid gap-3">
        {scarceRawIds.map((id) => (
          <div key={id} className="grid gap-1.5">
            <Label htmlFor={`raw-${id}`} className="flex items-center gap-2 text-sm">
              <span
                className={cn("size-2 rounded-full", ORE_SWATCH[id] ?? "bg-primary")}
                aria-hidden
              />
              {itemById[id].name}
            </Label>
            <Input
              id={`raw-${id}`}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              className="tabular-nums"
              value={Number.isFinite(values[id]) ? values[id] : 0}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange(id, Number.isFinite(n) && n >= 0 ? n : 0);
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
