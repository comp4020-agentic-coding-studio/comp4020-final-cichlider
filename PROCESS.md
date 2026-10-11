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

**Known gap (since fixed).** The arena was landscape (2400×1400), which showed
as a thin strip on a portrait phone. The second pivot below fixed it, because
the camera now follows your roller.

## Week 10, second pivot: you are the roller

**Why again.** I played the round-based version and it was still a drawing
app with a scoreboard: you dragged across the floor from anywhere, so position
meant nothing. I changed the rules again, the same week:

- The player *is* a roller, with five actions: forward, back, turn left, turn
  right, stay.
- The scene is 2.5D.
- Rounds are gone.
- NPCs fill in when there aren't enough people.
- There are several palettes to pick from, taken from my homepage.

Before any code I settled two ambiguous points. First, "pick a palette" means
picking one of the homepage's light/dark *pairs* for your own screen, so there
are still two teams. Second, without rounds, something has to stop the floor
filling up and freezing: paint now fades if nobody renews it.

**Directing the agent.** This rewrite turned the architecture over, so I had
Claude Code lay out the design before changing anything:

- The server simulates every roller at 20 Hz and streams positions and changed
  cells at 10 Hz.
- Clients send only their current action.
- NPCs use the same five actions through the same physics.
- Paint fades by a *game clock* that stops when nobody is on the floor. Without
  that, fading and "still there when you come back" contradict each other,
  because the Fly machine sleeps when nobody's connected. That became
  decision record 3.

The ink tank went too: with no "lift off" action, there's nothing for it to
pace. The whole change is
[`9986c54`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/9986c54).

**Grounding.** `pnpm check` passes with 24 tests:

- the course's 2;
- 7 in `spec/grid.test.ts` (ownership, fading, change reporting, save/restore);
- 6 in the new `spec/world.test.ts`, which drives the pure simulation directly:
  each action's effect, walls, collisions, NPCs topping up and stepping aside,
  and NPCs actually painting;
- 9 in `spec/turf.test.ts` against the running server, including a roller's
  move reaching another session's stream within a second.

I looped the server spec 40 times while the floor's paint aged past the fade
time, with no failures. By hand:

- With nobody on the floor, the game clock read the same 3 s apart (frozen).
- After a restart, the clock and the score came back identical.

I drove the game in a real headless Chrome over the DevTools protocol (dismiss
the welcome, hold W, then D) at 1280×800 and 390×844. The server's state
confirmed the roller moved and painted, and the screenshots confirmed the
isometric floor, the rollers, the bots and the palette picker. Because the
camera now follows your roller, the portrait-phone gap from the first pivot is
gone.

**Corrections along the way.**
- The server wouldn't start: node's type stripping can't run TypeScript
  parameter properties, and `tsc` hadn't complained. I fixed the class and
  turned on `erasableSyntaxOnly`, so `pnpm typecheck` now catches this before
  boot.
- A test asserted that bots are always present. After repeated runs, enough
  human test players were still on the floor that the bots had correctly
  stepped aside. The test now checks the real invariant: bots = max(0, 3 −
  people) per team.
- The snapshot test caught a real inconsistency. Fading ran once a second, so
  a cell could be reported up to a second past its fade time. Fading now runs
  every tick.
- The first screenshots showed rollers as thin sticks, and as tall slivers when
  they faced the camera. I enlarged them and replaced the fake drum (a thick
  line with fixed end ellipses) with a projected cylinder: two upright end
  circles, joined by their outline.

**Kept, deliberately.** The `paint` and `rounds` tables from earlier in the
week sit on the volume next to the wall's `strokes`, untouched. The floor is
now one row in a `floor` table.

## Decision record 2: the later roller wins

When two teams roll over the same cell, the later roller (in the server's
tick order) takes it. The options I weighed (first-holds, blending, letting
clients paint) and what this choice costs are in
[`docs/decisions/0002-last-roller-wins.md`](docs/decisions/0002-last-roller-wins.md),
revised for the roller version.

## Decision record 3: the world freezes when empty

Paint fades by a game clock that only runs while someone is on the floor, so
the floor is still there when people come back, even after the machine has
slept. See
[`docs/decisions/0003-the-world-freezes-when-empty.md`](docs/decisions/0003-the-world-freezes-when-empty.md).

## Where good is checked

See the table in `README.md`. The enforced claims live in `spec/grid.test.ts`,
`spec/world.test.ts` and `spec/turf.test.ts`. The freeze and restart are
checked by hand as above. What's judged (is the floor always changing, can you
feel yourself changing it) gets judged by my pod playing it at the crit.
