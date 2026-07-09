"use client";

import { itemById, scarceRawIds } from "@/data/items";
import type { ItemId } from "@/data/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface RawInputsPanelProps {
  values: Partial<Record<ItemId, number>>;
  onChange: (item: ItemId, value: number) => void;
}

export function RawInputsPanel({ values, onChange }: RawInputsPanelProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Raw inputs</CardTitle>
        <CardDescription>
          Available ore rates from your nodes (items/min).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 pt-4">
        {scarceRawIds.map((id) => (
          <div key={id} className="grid gap-1.5">
            <Label htmlFor={`raw-${id}`}>{itemById[id].name}</Label>
            <Input
              id={`raw-${id}`}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={Number.isFinite(values[id]) ? values[id] : 0}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange(id, Number.isFinite(n) && n >= 0 ? n : 0);
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
