import { Badge } from "@/components/ui/badge";
import type { SplitPlan } from "@/lib/solver/types";
import { cn } from "@/lib/utils";

interface SplitterPlanDisplayProps {
  plan: SplitPlan;
  variant?: "input" | "output";
  /** Use outline badges when nested on a tinted chip background */
  embedded?: boolean;
  className?: string;
}

function ratioLabel(plan: SplitPlan): string {
  if (plan.mergeOnly) return "Full belt";
  if (!plan.ratio) return "Programmable splitter";
  const { num, den } = plan.ratio;
  if (den === 1 || num === den) return "All belts";
  if (num === 1) return `1 of ${den} belts`;
  return `${num} of ${den} belts`;
}

function inputPrefix(plan: SplitPlan): string | null {
  if (plan.mergeOnly || !plan.ratio) return null;
  if (plan.ratio.den > 1 && plan.ratio.num === 1) {
    return `Feed ${plan.ratio.den} machines equally`;
  }
  return null;
}

export function SplitterPlanDisplay({
  plan,
  variant = "output",
  embedded = false,
  className,
}: SplitterPlanDisplayProps) {
  const fillBadge = embedded ? "outline" : "secondary";

  if (plan.mergeOnly) {
    return (
      <Badge variant={fillBadge} className={cn("font-normal", className)}>
        Full belt
      </Badge>
    );
  }

  if (!plan.ratio) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-amber-500/40 bg-amber-500/10 font-normal text-amber-700 dark:text-amber-400",
          className,
        )}
      >
        Programmable splitter
      </Badge>
    );
  }

  const prefix = variant === "input" ? inputPrefix(plan) : null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {prefix ? (
        <span className="text-[11px] text-muted-foreground">{prefix}</span>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {variant === "output" ? (
          <span className="text-[11px] text-muted-foreground">Take</span>
        ) : null}
        <Badge variant={fillBadge} className="font-normal tabular-nums">
          {ratioLabel(plan)}
        </Badge>
        {plan.steps.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {plan.steps.map((step, i) => (
              <span key={`${step}-${i}`} className="flex items-center gap-1">
                {i > 0 ? (
                  <span className="text-[10px] text-muted-foreground" aria-hidden>
                    →
                  </span>
                ) : null}
                <Badge variant="outline" className="font-mono text-[10px] font-normal">
                  {step}
                </Badge>
              </span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
