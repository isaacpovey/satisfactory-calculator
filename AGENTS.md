<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Cloud agents use `.cursor/environment.json` (Node 22 via `.cursor/Dockerfile`). After install, `pnpm run dev` is started on port 3000.

- Install: `pnpm install --frozen-lockfile`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Format: `pnpm run format:check`
- Typecheck: `pnpm run typecheck`
- Full check: `pnpm run check`
- Production build (static export to `out/`): `pnpm run build`

This app is a client-side static Next.js planner. No database or auth secrets are required for local/cloud runs. Do not commit `.env.local`.
