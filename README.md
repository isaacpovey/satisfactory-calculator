# Resource-Max Satisfactory Planner

Client-side Next.js planner for Satisfactory (Tier 0–4, standard recipes). Enter ore rates and minimum end-product targets; leftover capacity is split by balance sliders. Optional excess intermediary sinks are supported.

## Stack

- Next.js (App Router, static export)
- React client-side solver
- shadcn/ui + Tailwind CSS

## Develop

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```

## Build (static)

```bash
npm run build
```

Output is written to `out/` for static hosting.
