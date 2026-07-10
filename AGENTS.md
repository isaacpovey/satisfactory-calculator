<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Cloud agents use `.cursor/environment.json` (Node 22 via `.cursor/Dockerfile`). After install, `npm run dev` is started on port 3000.

- Install: `npm ci`
- Test: `npm test`
- Lint: `npm run lint`
- Production build (static export to `out/`): `npm run build`

This app is a client-side static Next.js planner. No database or auth secrets are required for local/cloud runs. Do not commit `.env.local`.
