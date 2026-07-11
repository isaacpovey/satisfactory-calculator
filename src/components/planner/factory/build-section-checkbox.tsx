"use client";

import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface BuildSectionCheckboxProps {
  sectionId: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}

export function BuildSectionCheckbox({
  sectionId,
  label,
  checked,
  onCheckedChange,
  children,
}: BuildSectionCheckboxProps) {
  return (
    <div
      data-section-id={sectionId}
      className={cn(
        "flex flex-col gap-3 rounded-xl transition-opacity duration-200",
        checked && "opacity-60",
      )}
    >
      <label className="flex cursor-pointer items-center gap-2.5">
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value)}
          aria-label={`Mark ${label} as built`}
        />
        <span
          className={cn("text-sm font-medium", checked && "text-muted-foreground line-through")}
        >
          {label}
        </span>
      </label>
      <div className={cn(checked && "pointer-events-none")}>{children}</div>
    </div>
  );
}
