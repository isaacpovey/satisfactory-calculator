"use client";

import { useState } from "react";
import { itemById, manufacturedItemIds } from "@/data/items";
import type { ItemId } from "@/data/types";
import type { ExcessSpec } from "@/lib/solver/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ExcessPanelProps {
  excess: ExcessSpec[];
  onChange: (excess: ExcessSpec[]) => void;
}

export function ExcessPanel({ excess, onChange }: ExcessPanelProps) {
  const [addKey, setAddKey] = useState(0);
  const used = new Set(excess.map((e) => e.item));
  const available = manufacturedItemIds.filter((id) => !used.has(id));

  function update(index: number, rate: number) {
    onChange(excess.map((e, i) => (i === index ? { ...e, rate } : e)));
  }

  function remove(index: number) {
    onChange(excess.filter((_, i) => i !== index));
  }

  function add(item: ItemId) {
    onChange([...excess, { item, rate: 0 }]);
    setAddKey((k) => k + 1);
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Excess intermediaries</CardTitle>
        <CardDescription>
          Reserve spare output of intermediate parts (items/min).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        {excess.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Optional — e.g. keep extra Iron Rods for hand crafting.
          </p>
        )}
        {excess.map((row, index) => (
          <div
            key={`${row.item}-${index}`}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border/80 bg-muted/30 p-3"
          >
            <div className="min-w-40 flex-1">
              <p className="mb-1.5 text-sm font-medium">
                {itemById[row.item].name}
              </p>
              <Label htmlFor={`excess-${row.item}`} className="sr-only">
                Excess rate
              </Label>
              <Input
                id={`excess-${row.item}`}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={row.rate}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  update(index, Number.isFinite(n) && n >= 0 ? n : 0);
                }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(index)}
            >
              Remove
            </Button>
          </div>
        ))}

        <div className="grid gap-1.5 sm:max-w-sm">
          <Label>Add intermediary</Label>
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
      </CardContent>
    </Card>
  );
}
