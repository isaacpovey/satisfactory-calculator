"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { overallBuildProgress } from "@/lib/build-sections";
import type { SavedFactory } from "@/lib/factory-storage";
import { formatPercent } from "@/lib/solver/format";
import { buttonVariants } from "@/components/ui/button";

interface FactoryShellProps {
  factory: SavedFactory;
  view: "summary" | "build";
  onNavigate: (view: "summary" | "build") => void;
  children: ReactNode;
}

export function FactoryShell({ factory, view, onNavigate, children }: FactoryShellProps) {
  const builtSet = new Set(factory.builtSections);
  const progress = overallBuildProgress(factory.result, builtSet);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/factories" className="text-sm text-muted-foreground hover:text-foreground">
              ← Saved factories
            </Link>
            <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">{factory.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Saved {new Date(factory.createdAt).toLocaleDateString()} ·{" "}
              {formatPercent(factory.result.overallUtilization)} ore used
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Build progress
            </p>
            <p className="font-heading text-lg font-semibold tabular-nums">
              {progress.built}/{progress.total} sections
            </p>
            <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: progress.total > 0 ? `${(progress.built / progress.total) * 100}%` : "0%",
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex gap-1 rounded-lg bg-muted/60 p-1 ring-1 ring-foreground/8">
            <button
              type="button"
              onClick={() => onNavigate("summary")}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                view === "summary"
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/8"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Summary
            </button>
            <button
              type="button"
              onClick={() => onNavigate("build")}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                view === "build"
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/8"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Build plan
            </button>
          </nav>
          <Link
            href={`/?edit=${factory.id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Pencil className="size-3.5" />
            Edit inputs
          </Link>
        </div>
      </header>

      {children}
    </div>
  );
}
