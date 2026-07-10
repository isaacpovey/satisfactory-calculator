"use client";

import { BELT_TIERS, type BeltTierId } from "@/data/belts";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface BeltTierPanelProps {
  maxBeltCapacity: number;
  onChange: (capacity: number) => void;
}

function capacityToId(capacity: number): BeltTierId {
  const tier = BELT_TIERS.find((t) => t.capacity === capacity);
  return tier?.id ?? "mk3";
}

export function BeltTierPanel({ maxBeltCapacity, onChange }: BeltTierPanelProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card/90 p-4 ring-1 ring-foreground/8">
      <div>
        <h2 className="font-heading text-sm font-semibold tracking-tight">Max belt tier</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Machine banks and merges stay within this conveyor capacity.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="max-belt" className="text-xs text-muted-foreground">
          Unlocked conveyor
        </Label>
        <Select
          value={capacityToId(maxBeltCapacity)}
          onValueChange={(id) => {
            const tier = BELT_TIERS.find((t) => t.id === id);
            if (tier) onChange(tier.capacity);
          }}
        >
          <SelectTrigger id="max-belt" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BELT_TIERS.map((tier) => (
              <SelectItem key={tier.id} value={tier.id}>
                {tier.name} · {tier.capacity}/min
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
