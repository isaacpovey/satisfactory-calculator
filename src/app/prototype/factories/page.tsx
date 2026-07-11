"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { deleteFactory, listFactories, type SavedFactory } from "@/lib/factory-storage";
import { overallBuildProgress } from "@/lib/build-sections";
import { formatPercent } from "@/lib/solver/format";
import { itemById } from "@/data/items";

export default function FactoriesPage() {
  const [factories, setFactories] = useState<SavedFactory[]>([]);

  const reload = useCallback(() => {
    setFactories(listFactories());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteFactory(id);
    reload();
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-center text-sm text-primary">
        Design prototype — saved factories are stored in this browser only
      </div>

      <header>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to planner
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">Saved factories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plans you saved for later — no recomputing required.
        </p>
      </header>

      {factories.length === 0 ? (
        <div className="rounded-xl bg-card/70 p-8 text-center ring-1 ring-foreground/8">
          <p className="font-heading font-semibold">No saved factories yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open the demo factory and use &ldquo;Save as factory&rdquo; to create one.
          </p>
          <Link href="/prototype/factory/demo/summary" className={buttonVariants({ className: "mt-4" })}>
            Open demo factory
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {factories.map((factory) => {
            const builtSet = new Set(factory.builtSections);
            const progress = overallBuildProgress(factory.result, builtSet);
            const targetSummary = factory.result.targets
              .slice(0, 3)
              .map((t) => itemById[t.item].name)
              .join(", ");

            return (
              <li
                key={factory.id}
                className="flex flex-col gap-3 rounded-xl bg-card/90 p-4 ring-1 ring-foreground/8 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/prototype/factory/${factory.id}/summary`}
                    className="font-heading text-lg font-semibold hover:text-primary"
                  >
                    {factory.name}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {targetSummary}
                    {factory.result.targets.length > 3 ? "…" : ""} ·{" "}
                    {formatPercent(factory.result.overallUtilization)} ore
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(factory.createdAt).toLocaleString()} · {progress.built}/
                    {progress.total} sections built
                  </p>
                  <div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width:
                          progress.total > 0
                            ? `${(progress.built / progress.total) * 100}%`
                            : "0%",
                      }}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    href={`/prototype/factory/${factory.id}/summary`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Open
                  </Link>
                  {factory.id !== "demo" ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(factory.id, factory.name)}
                      aria-label={`Delete ${factory.name}`}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
