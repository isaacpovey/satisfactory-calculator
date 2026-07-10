import type { ItemId } from "@/data/types";
import { FlowEndpointLink, ItemFlowLink } from "@/components/planner/flow-endpoint-link";
import { SplitterPlanDisplay } from "@/components/planner/splitter-plan-display";
import { formatRate } from "@/lib/solver/format";
import type { FlowEdge, MergePlan } from "@/lib/solver/types";
import { cn } from "@/lib/utils";

const EPS = 1e-6;

interface DownstreamLanesProps {
  itemId: ItemId;
  lanes: MergePlan[];
  edges: FlowEdge[];
}

function destinationLabel(lane: MergePlan): string {
  if (lane.routing === "demand-balanced-manifold") return "Shared output manifold";
  if (!lane.to) return "Output belt";
  if (lane.to.kind === "excess") return "Overflow belt";
  if (lane.to.kind === "target") return `Belt to target`;
  return `Belt to ${lane.to.id}`;
}

export function DownstreamLanes({ itemId, lanes, edges }: DownstreamLanesProps) {
  if (lanes.length === 0) {
    if (edges.length === 0) return null;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {edges.map((edge, i) => (
          <ConsumerRow key={`flat-${i}`} edge={edge} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Downstream by destination
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Dedicated belts stay direct; shared belts use downstream backpressure to hold each solved
          rate.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {lanes.map((lane, laneIndex) => {
          const onLane = edges.filter((e) => e.fromLaneIndex === laneIndex);
          const production = onLane.filter((e) => e.to.kind !== "excess");
          const overflow = onLane.filter((e) => e.to.kind === "excess");
          const accounted = onLane.reduce((s, e) => s + e.rate, 0);
          const gap = Math.max(0, lane.rate - accounted);

          return (
            <div
              key={`lane-${laneIndex}`}
              className="flex flex-col gap-3 rounded-xl bg-muted/40 px-4 py-3.5 ring-1 ring-foreground/8"
            >
              <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-foreground/8 pb-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {destinationLabel(lane)}
                  </p>
                  <ItemFlowLink itemId={itemId} embedded />
                  {lane.to && lane.to.kind !== "excess" ? (
                    <span className="text-[11px] text-muted-foreground">
                      <FlowEndpointLink kind={lane.to.kind} id={lane.to.id} embedded />
                    </span>
                  ) : null}
                </div>
                <p className="font-heading text-base font-semibold tabular-nums">
                  {formatRate(lane.rate)}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                    /min on belt
                  </span>
                </p>
              </header>

              {production.length === 0 && overflow.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No downstream on this belt</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {production.map((edge, i) => (
                    <ConsumerRow key={`p-${laneIndex}-${i}`} edge={edge} laneRate={lane.rate} />
                  ))}
                  {overflow.map((edge, i) => (
                    <ConsumerRow key={`o-${laneIndex}-${i}`} edge={edge} laneRate={lane.rate} />
                  ))}
                  {gap > EPS ? (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      {formatRate(gap)}/min unaccounted on belt
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConsumerRow({ edge, laneRate }: { edge: FlowEdge; laneRate?: number }) {
  const kindTone =
    edge.to.kind === "excess"
      ? "border-l-2 border-l-amber-500/50 bg-amber-500/5"
      : edge.to.kind === "target"
        ? "border-l-2 border-l-sky-500/40 bg-sky-500/5"
        : "border-l-2 border-l-foreground/15 bg-background/70";

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md px-2.5 py-2 ring-1 ring-foreground/8",
        kindTone,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium">
          <FlowEndpointLink kind={edge.to.kind} id={edge.to.id} embedded />
        </span>
        <span className="text-sm font-semibold tabular-nums">{formatRate(edge.rate)}/min</span>
      </div>

      <SplitterPlanDisplay plan={edge.outputSplit} variant="output" embedded />
      {laneRate != null && edge.outputSplit.restAfterOverflow && edge.rate + EPS < laneRate ? (
        <p className="text-[11px] text-muted-foreground">
          {formatRate(edge.rate)} of {formatRate(laneRate)}/min on belt
        </p>
      ) : null}
    </div>
  );
}
