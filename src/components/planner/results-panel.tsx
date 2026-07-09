"use client";

import { itemById } from "@/data/items";
import type { SolveResult } from "@/lib/solver/types";
import { formatClock } from "@/lib/solver/constraints";
import {
  formatMachines,
  formatPercent,
  formatRate,
} from "@/lib/solver/format";
import type { AllowedClock } from "@/lib/solver/constraints";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ResultsPanelProps {
  result: SolveResult;
}

export function ResultsPanel({ result }: ResultsPanelProps) {
  const shortfalls = result.raws.filter((r) => r.shortfall > 1e-6);

  return (
    <div className="flex flex-col gap-4">
      {!result.feasible && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
        >
          <p className="font-medium text-destructive">
            Minimum targets exceed available resources
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive/90">
            {shortfalls.map((r) => (
              <li key={r.item}>
                {itemById[r.item].name}: need{" "}
                {formatRate(r.available + r.shortfall)}/min, have{" "}
                {formatRate(r.available)}/min (short{" "}
                {formatRate(r.shortfall)}/min)
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Utilization</CardTitle>
              <CardDescription>
                Scarce raw usage after minima, balance sliders, and auto excess
                fill (whole machines / easy underclocks).
              </CardDescription>
            </div>
            <Badge variant={result.feasible ? "secondary" : "destructive"}>
              Overall {formatPercent(result.overallUtilization)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Leftover</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.raws.map((r) => (
                <TableRow key={r.item}>
                  <TableCell className="font-medium">
                    {itemById[r.item].name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(r.available)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(r.used)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(r.leftover)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(r.utilization)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Target outputs</CardTitle>
          <CardDescription>
            Minimum plus leftover allocation (items/min).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {result.targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No targets selected.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Planned min</TableHead>
                  <TableHead className="text-right">Extra</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.targets.map((t) => (
                  <TableRow key={t.item}>
                    <TableCell className="font-medium">
                      {itemById[t.item].name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(t.minRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(t.plannedMinRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(t.extraRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatRate(t.totalRate)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Machines</CardTitle>
          <CardDescription>
            Whole buildings at 100% / 75% / 66.67% / 50% / 33.33% / 25% clock
            (integer machine counts).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {result.recipes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No production required yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipe</TableHead>
                  <TableHead>Building</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Clock</TableHead>
                  <TableHead className="text-right">Output/min</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.recipes.map((r) => (
                  <TableRow key={r.recipeId}>
                    <TableCell className="font-medium">{r.recipeName}</TableCell>
                    <TableCell>{r.building}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMachines(r.machines)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatClock(r.clock as AllowedClock)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(r.outputPerMinute)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Item flow</CardTitle>
          <CardDescription>
            Produced vs consumed across the recipe chain (items/min).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {result.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No item flow yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Produced</TableHead>
                  <TableHead className="text-right">Consumed</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((row) => (
                  <TableRow key={row.item}>
                    <TableCell className="font-medium">
                      {itemById[row.item]?.name ?? row.item}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.produced)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.consumed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.net)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
