# Rules for working on The Wall

`README.md` is the argument for what good means here; these rules come from it.
Read it before changing behaviour.

## Never

- Never add a way for anyone (including an admin) to delete or alter another
  painter's marks from the app. Only the author may take a mark back
  (`DELETE /api/strokes/:id` checks this; `spec/wall.test.ts` holds it).
- Never make hiding a painter affect anyone else. Hidden painters live in the
  viewer's own `localStorage` and are never sent to the server.
- Never require sign-up to paint. A visitor gets a tag from `POST /api/session`.
- Never store anything outside `/data` (`DATA_DIR`): that volume is the only
  storage that survives a redeploy.
- Never make a stored stroke render differently on a reload. Anything random
  (the spray) is derived from the stroke's stored `seed`.

## Always

- New live behaviour must reach other open sessions within ~1 second; the SSE
  test in `spec/wall.test.ts` is the yardstick. Don't add batching that breaks it.
- Validate every stroke on the server (`server/stroke.ts`) before it touches the
  database. The client is untrusted.
- Keep it within one 256 MB machine: no extra services, no heavy dependencies.
  A new runtime dependency needs a reason written in `PROCESS.md`.
- Keep `/readme/` rendering the whole README server-side (no script needed).
- Run `pnpm check` against a running app (`pnpm dev` locally) before saying a
  change works; a red check is a stop, not a suggestion.

## Layout

- `server/main.ts` — HTTP routes, SQLite, SSE fan-out, rate limit.
- `server/stroke.ts` — what a stroke may be (shared limits).
- `public/` — the client: `app.js` (input, camera, sync), `render.js` (how a
  stroke looks; must stay deterministic).
- `spec/` — checks against the running app. Test marks go in the far corner
  (`-900000, -900000`) and are cleaned up.
- `scripts/seed.ts` — paints the first marks through the public API.
