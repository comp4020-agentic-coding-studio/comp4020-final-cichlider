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

## Where good is checked

See the table in `README.md`: what's enforced lives in `spec/wall.test.ts`;
what's judged (are the tools worth picking up, does it feel crowded but not
ruined) gets judged by my pod at the crit.
