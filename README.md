# Resource-Max Satisfactory Planner

Client-side Next.js planner for Satisfactory (Tier 0–4 standard recipes plus early MAM Caterium, Quartz, and Sulfur chains). Enter ore rates and minimum end-product targets; leftover capacity is split by balance sliders. Optional excess intermediary sinks are supported.

## Stack

- Next.js (App Router, static export)
- React client-side solver
- shadcn/ui + Tailwind CSS

## Develop

```bash
pnpm install
pnpm run dev
```

## Test

```bash
pnpm test
```

## Build (static)

```bash
pnpm run build
```

Output is written to `out/` for static hosting.
