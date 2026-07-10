"use client";

import type { ReactNode } from "react";
import { itemById } from "@/data/items";
import { getRecipeForProduct } from "@/data/recipes";
import type { ItemId } from "@/data/types";
import { cn } from "@/lib/utils";

export type FlowLinkKind = "stage" | "raw" | "recipe" | "target" | "excess";

export function anchorForFlowKind(kind: FlowLinkKind, id: string): string {
  switch (kind) {
    case "stage":
    case "recipe":
      return `#stage-${id}`;
    case "raw":
      return `#raw-${id}`;
    case "target":
      return `#target-${id}`;
    case "excess":
      return `#excess-${id}`;
  }
}

export function anchorForItem(itemId: ItemId): string | null {
  const item = itemById[itemId];
  if (!item) return null;
  if (item.isRaw) return `#raw-${itemId}`;
  const producer = getRecipeForProduct(itemId);
  if (producer) return `#stage-${producer.id}`;
  return null;
}

export function openDetailsForHash(hash: string): void {
  if (!hash.startsWith("#")) return;
  const id = hash.slice(1);
  let el = document.getElementById(id);
  if (!el && id.startsWith("raw-")) {
    el = document.querySelector(`[id^="${id}-"]`);
  }
  if (!el) return;
  let parent = el.parentElement;
  while (parent) {
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      parent.open = true;
    }
    parent = parent.parentElement;
  }
}

export function scrollToAnchor(hash: string): void {
  if (!hash.startsWith("#")) return;
  openDetailsForHash(hash);
  const id = hash.slice(1);
  let el = document.getElementById(id);
  if (!el && id.startsWith("raw-")) {
    el = document.querySelector(`[id^="${id}-"]`);
  }
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", hash);
}

interface FlowEndpointLinkProps {
  kind: FlowLinkKind;
  id: string;
  label?: string;
  className?: string;
  children?: ReactNode;
  /** Use on tinted chip backgrounds — inherits parent text color */
  embedded?: boolean;
}

const linkStyles = {
  default: "text-primary underline-offset-2 hover:underline focus-visible:underline",
  embedded:
    "text-inherit underline decoration-foreground/35 underline-offset-2 hover:decoration-foreground focus-visible:decoration-foreground",
} as const;

export function FlowEndpointLink({
  kind,
  id,
  label,
  className,
  children,
  embedded = false,
}: FlowEndpointLinkProps) {
  const href = anchorForFlowKind(kind, id);
  const text = children ?? label ?? id;

  return (
    <a
      href={href}
      className={cn(embedded ? linkStyles.embedded : linkStyles.default, className)}
      onClick={(e) => {
        e.preventDefault();
        scrollToAnchor(href);
      }}
    >
      {text}
    </a>
  );
}

interface ItemFlowLinkProps {
  itemId: ItemId;
  className?: string;
  children?: ReactNode;
  embedded?: boolean;
}

export function ItemFlowLink({ itemId, className, children, embedded = false }: ItemFlowLinkProps) {
  const href = anchorForItem(itemId);
  const name = itemById[itemId]?.name ?? itemId;

  if (!href) {
    return <span className={className}>{children ?? name}</span>;
  }

  return (
    <a
      href={href}
      className={cn(embedded ? linkStyles.embedded : linkStyles.default, className)}
      onClick={(e) => {
        e.preventDefault();
        scrollToAnchor(href);
      }}
    >
      {children ?? name}
    </a>
  );
}
