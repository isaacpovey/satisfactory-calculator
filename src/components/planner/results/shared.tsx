import type { ReactNode } from "react";
import type { ItemId } from "@/data/types";
import { formatPercent, formatRate } from "@/lib/solver/format";
import { cn } from "@/lib/utils";

export const ORE_SWATCH: Partial<Record<ItemId, string>> = {
  "iron-ore": "bg-ore-iron",
  "copper-ore": "bg-ore-copper",
  limestone: "bg-ore-limestone",
  coal: "bg-ore-coal",
  "caterium-ore": "bg-ore-caterium",
  "raw-quartz": "bg-ore-quartz",
  sulfur: "bg-ore-sulfur",
};

export function changedRing(changed: boolean): string {
  return changed
    ? "ring-2 ring-primary/55 bg-primary/[0.06] shadow-[0_0_0_1px_oklch(0.5_0.14_42/0.2)]"
    : "ring-1 ring-foreground/8";
}

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
          {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function UtilMeter({
  name,
  used,
  available,
  utilization,
  leftover,
  swatch,
  changed,
}: {
  name: string;
  used: number;
  available: number;
  utilization: number;
  leftover: number;
  swatch?: string;
  changed?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, utilization * 100));
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl bg-card/80 p-3 transition-[box-shadow,background-color] duration-300",
        changedRing(!!changed),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn("size-2.5 shrink-0 rounded-full", swatch ?? "bg-primary")}
            aria-hidden
          />
          <span className="truncate font-medium">{name}</span>
          {changed ? (
            <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              updated
            </span>
          ) : null}
        </div>
        <span className="shrink-0 font-heading text-sm font-semibold tabular-nums">
          {formatPercent(utilization)}
        </span>
      </div>
      <meter
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted accent-primary"
        value={pct}
        min={0}
        max={100}
        aria-label={`${name} utilization`}
      />
      <p className="text-xs tabular-nums text-muted-foreground">
        {formatRate(used)} / {formatRate(available)}
        {leftover > 1e-6 ? ` · ${formatRate(leftover)} left` : ""}
      </p>
    </div>
  );
}
