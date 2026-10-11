# Process overview

## Week 9 (crit 8): from brief to a live wall

**The idea.** The brief asks for a multi-user, real-time site that's *good*. I
chose a graffiti wall because co-presence is built into what a wall is: it's
more interesting when other people have painted on it, and most interesting
when they're painting next to you right now. The one design decision I gave the
agent up front was the tension in the README: a wall that's crowded but not
ruined. That's why the app lets you **hide a painter for yourself** instead of
letting anyone delete anyone.

**Directing the agent.** I gave Claude Code the concept, the tool range I wanted,
"a big wall you can wander across", and the per-viewer ignore feature. I also
asked it to paint the first marks itself, so the wall isn't empty for the first
stranger. It proposed the stack below; I accepted it for the reasons in the
decision record.

**Grounding.** The work was checked against the running app, not just read:
`pnpm check` ran against a local server (8 tests: the course's 2, plus 6 in
`spec/wall.test.ts` for persistence, sub-second sync, ownership and input
validation). A headless-Chrome screenshot of the seeded wall confirmed the
rendering before deploy. The whole first version is
[`449b251`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/449b251).

**Corrections along the way.** The first client build started its render loop
before the drawing state existed, which would have thrown on load. It was caught
by reading the module order before running it and fixed in the same commit. The
first screenshot attempt hung because headless Chrome's virtual time never
settles while a page holds an open event stream and an animation loop. I switched
to a timed capture rather than changing the app to suit the tool.

## Decision record 1: the stack

**Context.** One shared-cpu-1x machine with 256 MB, one volume at `/data`, and
no database server. It needs sub-second fan-out to every open browser. One
person builds it in a few weeks.

**Decision.**
- **Node 24, TypeScript run directly** (type stripping): no build step, and the
  same language as the course's harness.
- **SQLite via the built-in `node:sqlite`**, file on `/data`: zero extra
  services, and durable across redeploys.
- **Server-sent events** for live updates. Writes are ordinary POSTs. A wall's
  traffic is mostly server→many-clients (strokes, cursors), which is exactly what
  SSE does. It reconnects by itself, and it passes through Fly's proxy with only a
  keep-alive ping. WebSockets would buy duplex traffic I don't need.
- **Plain canvas JS** on the client. The interesting work is in drawing, and a
  framework adds nothing there.
- **Strokes as vectors**, not pixels: each stroke stores its points, tool and
  seed. That makes per-viewer hiding trivial (just don't draw that painter's
  strokes), which a shared bitmap could never do. It also makes undo exact.
- One runtime dependency, `marked`, to render README.md at `/readme/`
  server-side.

**Consequences.** The whole visible region is redrawn from vectors when the view
moves. That's fine at hundreds to low thousands of strokes per screen. If the
showcase pushes past that, the next step is cached tiles, and that will get its
own record. Rate limiting is in memory, which is fine with one machine.

## Week 10 (crit 9): from a wall to a game

**The pivot.** Crit 9 asks for real-time and for one decision about how the app
behaves when several people use it at once. The wall already had live sync
from crit 8, so the real-time half was done. Thinking about the decision half
showed me what was missing. On the wall, several people at once mostly meant
several people *not* bumping into each other: everyone had their own patch, and
"nobody can cover anybody" kept them apart. I wanted the opposite, people
crashing into each other on purpose. So I turned it into a game, modelled on
Splatoon's Turf War. That reversed the wall's founding rule, and the reversal
became this week's decision record.

**Directing the agent.** I set the reference (Splatoon), the mode (turf war),
the tool (one fixed roller instead of a toolbar), and the colours (two team
colours; Splatoon-style placeholders for now, to be swapped for the two from my
homepage). I then asked Claude Code to act as game designer and propose the
core loop before writing code. It proposed: join the smaller team, roll paint,
last roller owns the floor, a fixed arena, timed rounds, then result and the
next round. I asked for a near-complete version this week rather than just the
decision doc. The ink tank was added during planning, because without it one
fast player could sweep the whole floor in a single stroke. The whole change is
[`74094fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/74094fd).

**Grounding.** `pnpm check` passes against a local server: 17 tests, the
course's 2 plus 5 in `spec/grid.test.ts` on the ownership rule itself and 10 in
`spec/turf.test.ts` against the running app (teams, live sync under a second,
last roller wins, server-assigned colour, ink limit, bad input). Some things
the spec can't reach, since CI can't wait out a 150-second round, so I checked
those by hand with a server running 20-second rounds:

- I watched the event stream go round-start → round-end (winner, cell counts)
  → 3 s break → round-start.
- I confirmed in SQLite that each finished round was recorded and its paint
  deleted.
- I killed the server mid-round, restarted it, and got the same round id and
  the same cell counts back.

Headless-Chrome screenshots at 1280×800 and at 390 px wide checked the layout.

**Corrections along the way.**
- The plan said to reuse the wall's speed-sensitive brush as the roller's look.
  That would have made the drawn band narrower or wider than what the grid
  scores, which breaks "the floor is the scoreboard". So the roller is drawn as
  a fixed-width band, the same shape the grid stamps (now a rule in `CLAUDE.md`).
- The README's link to the decision record would have pointed to a path the
  server doesn't serve once rendered at `/readme/`. It now links to the file
  on GitHub.
- The welcome title's pink-to-lime gradient turned muddy orange in the middle,
  so it's now two solid words in the two team colours.
- The first phone screenshot looked broken. The cause was headless Chrome's
  minimum window width, not the layout: rendered inside a real 390 px frame, it
  fits.
- When seeding test paint, back-to-back strokes from one player were refused.
  That was the ink tank working as designed, not a bug.
- The spec failed once out of many runs. A test that landed in the last
  seconds of a round waited for the next one, which took longer than vitest's
  5-second limit. I reproduced it by looping the spec across round boundaries,
  gave the round-waiting tests 30 seconds, then ran the loop 45 times with no
  failures.

**Kept, deliberately.** The crit-8 `strokes` table is still on the Fly volume,
untouched. Turf war writes to new `paint` and `rounds` tables. Rather than
delete the old wall's paint, I left it, unused. `scripts/seed.ts` is retired:
rounds wipe the floor on their own, so there's no empty wall to dress up for the
first visitor.

**Known gap.** The arena is landscape (2400×1400). On a portrait phone it shows
as a thin strip with a thin roller unless you pinch-zoom. My pod will probably
play on phones, so that's the first thing to fix after this crit.

## Decision record 2: the last roller wins

When two teams paint the same cell, the later stroke (as the server receives
it) takes it. The options I weighed (first-holds, blending, client
timestamps) and what this choice costs are in
[`docs/decisions/0002-last-roller-wins.md`](docs/decisions/0002-last-roller-wins.md).

## Where good is checked

See the table in `README.md`. The enforced claims live in `spec/grid.test.ts`
and `spec/turf.test.ts`; round timing across a restart is checked by hand as
above. What's judged — is it close until the end, does painting over them feel
good — gets judged by my pod playing against each other at the crit.
