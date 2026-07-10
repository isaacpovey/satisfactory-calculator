import { Badge } from "@/components/ui/badge";
import { formatRate } from "@/lib/solver/format";
import type { MergerStageRate, SplitterStageRate } from "@/lib/solver/group-inputs";
import { cn } from "@/lib/utils";

function RateText({ rate, className }: { rate: number; className?: string }) {
  return (
    <span className={cn("tabular-nums font-semibold", className)}>
      {formatRate(rate)}
      <span className="ml-0.5 font-normal text-muted-foreground">/min</span>
    </span>
  );
}

/** Vertical splitter ladder: one clear step per nested 1/2 · 1/3. */
export function InputSplitVisual({
  stages,
  machines,
  perMachineRate,
}: {
  stages: SplitterStageRate[];
  machines: number;
  perMachineRate: number;
}) {
  if (stages.length === 0) return null;

  const beltIn = stages[0]!;
  const splits = stages.slice(1);

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-0">
        <li className="flex items-center gap-3 py-1.5">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">Belt in</span>
          <RateText rate={beltIn.rate} className="text-sm text-foreground" />
        </li>
        {splits.map((stage, i) => (
          <li
            key={`split-${i}`}
            className="flex items-center gap-3 border-t border-foreground/8 py-1.5"
          >
            <Badge
              variant="outline"
              className="w-14 shrink-0 justify-center font-mono text-[10px] font-normal"
            >
              {stage.step}
            </Badge>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <RateText rate={stage.rate} className="text-sm" />
              <span className="text-[11px] text-muted-foreground">
                × {stage.lanes} lane{stage.lanes === 1 ? "" : "s"}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <div className="rounded-md bg-muted/50 px-2.5 py-2">
        <p className="text-[11px] text-muted-foreground">
          Feeds <span className="font-medium text-foreground tabular-nums">{machines}</span> machine
          {machines === 1 ? "" : "s"} at <RateText rate={perMachineRate} className="text-[11px]" />{" "}
          each
        </p>
      </div>
    </div>
  );
}

/** Vertical merge ladder with stable bank labels. */
export function OutputMergeVisual({
  sourceRates,
  sourceBankIndexes,
  stages,
  finalRate,
}: {
  sourceRates: number[];
  sourceBankIndexes: number[];
  stages: MergerStageRate[];
  finalRate: number;
}) {
  if (sourceRates.length === 0) return null;

  const mergeSteps = stages.slice(1);

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {sourceRates.map((rate, i) => {
          const bankNo = (sourceBankIndexes[i] ?? i) + 1;
          return (
            <li
              key={`src-${bankNo}`}
              className="flex items-center justify-between gap-3 rounded-md bg-background/70 px-2.5 py-1.5 ring-1 ring-foreground/8"
            >
              <span className="text-[11px] text-muted-foreground">Bank {bankNo}</span>
              <RateText rate={rate} className="text-sm" />
            </li>
          );
        })}
      </ul>

      {mergeSteps.length > 0 ? (
        <ol className="flex flex-col border-l-2 border-primary/20 pl-3">
          {mergeSteps.map((stage, i) => (
            <li
              key={`merge-${i}`}
              className={cn(
                "flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5",
                i > 0 && "border-t border-foreground/8",
              )}
            >
              {stage.step ? (
                <Badge variant="outline" className="font-mono text-[10px] font-normal">
                  {stage.step}
                </Badge>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {stage.beltsIn === 1 ? "combined belt" : `${stage.beltsIn} belts`}
              </span>
              <RateText
                rate={stage.rate}
                className={cn("text-sm", stage.beltsIn === 1 && "text-primary")}
              />
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md bg-primary/8 px-2.5 py-1.5">
          <span className="text-[11px] text-muted-foreground">Out</span>
          <RateText rate={finalRate} className="text-sm text-primary" />
        </div>
      )}
    </div>
  );
}
