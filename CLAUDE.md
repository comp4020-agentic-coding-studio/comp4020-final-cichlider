# Rules for working on Turf War

`README.md` is the argument for what good means here; these rules come from it.
Read it before changing behaviour. This was The Wall until crit 9, and some of
the wall's rules are now reversed on purpose. Don't bring them back.

## Never

- Never let a client move a roller or paint directly. A client sends one of the
  five actions (`move` and `turn`, each -1, 0 or 1) and nothing else. The server
  moves every roller and stamps every cell.
- Never give NPCs abilities players don't have. A bot chooses `move` and
  `turn` the same way a player presses keys (`World.think` in
  `server/world.ts`), then goes through the same `step()`.
- Never protect paint from being rolled over. The later roller owns the cell
  (`docs/decisions/0002-last-roller-wins.md`).
- Never make what's drawn differ from what's scored. The client outlines the
  server's grid (marching squares in `render.js`); drips are simulated on the
  server and paint the grid like rollers do. Don't add client-side paint, drips
  or splashes that the grid doesn't have.
- Never let the game clock run with nobody on the floor, or age paint by the
  wall clock (`docs/decisions/0003-the-world-freezes-when-empty.md`).
- Never tie colours to the server. Teams are 0 (the light colour) and 1 (the
  dark colour); `public/palettes.js` is the only place colours live, and the
  palette is each viewer's own choice.
- Never require sign-up to play. A visitor gets a tag and a team from
  `POST /api/session`, and the first `POST /api/input` puts them on the floor.
- Never take a player ID from a mutation body as authority. Resolve the actor
  from the bearer secret on the server; never print that secret or an
  Authorization header in logs.
- Never store anything outside `/data` (`DATA_DIR`): that volume is the only
  storage that survives a redeploy.
- Never touch earlier versions' tables on the volume (`strokes`, `paint`,
  `rounds`). They're kept and unused.

## Always

- New live behaviour must reach other open sessions within ~1 second; the
  stream tests in `spec/turf.test.ts` are the yardstick.
- Keep one structured server log line for each meaningful human event, with a
  stable user ID and tag; do not log repeated input heartbeats or every tick.
- Keep `server/grid.ts` and `server/world.ts` pure (no I/O, time passed in), so
  `spec/grid.test.ts` and `spec/world.test.ts` can drive them directly.
- Keep the client's numbers (arena, cell, roller width, fade time) coming from
  `GET /api/state`, never hard-coded in `public/`.
- Write TypeScript that node can run by stripping types: no parameter
  properties, no enums. `erasableSyntaxOnly` in `tsconfig.json` catches these
  at `pnpm typecheck`.
- Keep it within one 256 MB machine: no extra services, no heavy dependencies.
  A new runtime dependency needs a reason written in `PROCESS.md`.
- Keep `/readme/` rendering the whole README server-side (no script needed).
- Run `pnpm check` against a running app (`pnpm dev` locally) before saying a
  change works; a red check is a stop, not a suggestion. For anything you can
  only see in the browser, drive it in headless Chrome and look at it.

## Layout

- `server/main.ts`: HTTP routes, SQLite, the tick loop and game clock, saving
  the floor, SSE fan-out, rate limit.
- `server/world.ts`: rollers, the five actions, collisions, NPCs.
- `server/grid.ts`: the arena, who owns each cell, fading.
- `server/input.ts`: what a client may send.
- `public/`: the client. `app.js` handles input, sync, camera and HUD;
  `render.js` draws the isometric floor and rollers; `palettes.js` holds the
  homepage colour pairs.
- `spec/`: `grid.test.ts` and `world.test.ts` drive the pure modules;
  `turf.test.ts` runs against the running app. Test players leave the floor by
  themselves after 15 s of quiet.
- `docs/decisions/`: decision records after the first one (which lives in
  `PROCESS.md`).
