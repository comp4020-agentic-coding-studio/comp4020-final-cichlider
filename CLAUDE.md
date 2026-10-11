# Rules for working on Turf War

`README.md` is the argument for what good means here; these rules come from it.
Read it before changing behaviour. This was The Wall until crit 9, and some of
the wall's rules are now reversed on purpose. Don't bring them back.

## Never

- Never let the client choose a stroke's colour or team. The server takes the
  team from the painter (`users.team`) and ignores anything the client sends.
  Strokes store the team, never a colour.
- Never protect paint from being painted over. The last roller over a cell owns
  it (`server/grid.ts`; the reasons are in
  `docs/decisions/0002-last-roller-wins.md`). There's no undo and no per-player
  hiding: the floor is the scoreboard, and everyone has to see the same one.
- Never make what's drawn differ from what's scored. A roller stroke renders as
  a round-ended band of width `ROLLER`, which is the same shape the grid stamps.
  If one changes, the other changes with it.
- Never require sign-up to play. A visitor gets a tag and a team from
  `POST /api/session`.
- Never store anything outside `/data` (`DATA_DIR`): that volume is the only
  storage that survives a redeploy.
- Never touch the crit-8 `strokes` table on the volume. It's the old wall's
  paint, kept and unused.

## Always

- New live behaviour must reach other open sessions within ~1 second; the SSE
  test in `spec/turf.test.ts` is the yardstick. Don't add batching that breaks it.
- Validate every stroke on the server (`server/stroke.ts`) before it touches the
  database or the grid: roller only, inside the arena, within the ink the
  painter has. The client is untrusted.
- Keep the client's numbers (arena, roller width, ink) coming from
  `GET /api/round`, never hard-coded in `public/`.
- Keep it within one 256 MB machine: no extra services, no heavy dependencies.
  A new runtime dependency needs a reason written in `PROCESS.md`.
- Keep `/readme/` rendering the whole README server-side (no script needed).
- Run `pnpm check` against a running app (`pnpm dev` locally) before saying a
  change works; a red check is a stop, not a suggestion. For anything about
  round timing, also run with short rounds (`ROUND_MS=20000 BREAK_MS=3000`) and
  watch a round end.

## Layout

- `server/main.ts`: HTTP routes, SQLite, teams, the round clock, the ink tank,
  SSE fan-out, rate limit.
- `server/grid.ts`: the arena and who owns which cell. Pure, shared with the spec.
- `server/stroke.ts`: what a stroke may be.
- `public/`: the client. `app.js` handles input, camera, sync and the HUD;
  `render.js` decides how paint looks (it must match the grid).
- `spec/`: `grid.test.ts` tests the ownership rule directly; `turf.test.ts`
  runs against the running app. Tests make fresh players and paint wherever;
  rounds clean themselves up.
- `docs/decisions/`: decision records after the first one (which lives in
  `PROCESS.md`).
