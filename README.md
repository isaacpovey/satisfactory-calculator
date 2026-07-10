# Resource-Max Satisfactory Planner

Client-side Next.js planner for Satisfactory (Tier 0–4 standard recipes plus early MAM Caterium, Quartz, and Sulfur chains). Its exact CP-SAT model maximizes raw-resource use, applies target weights, and then minimizes machines, groups, and routing complexity while enforcing item conservation.

## Stack

- Next.js (App Router, static export)
- OR-Tools CP-SAT running parallel search in a browser Web Worker
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

The solver's threaded WebAssembly runtime requires these response headers on every static asset:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`vercel.json` configures them for Vercel. Other static hosts must apply equivalent headers.

The exact solver uses up to eight logical cores, reserving one core for browser responsiveness.
Long solves show the active lexicographic objective phase and elapsed time after 15 seconds.
