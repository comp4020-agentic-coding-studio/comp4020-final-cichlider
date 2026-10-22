# Process overview

## From a shared wall to a game

I started with a graffiti wall because the final brief's three fixed demands
could serve one idea: other people should make the surface more interesting.
The first version, [`449b251`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/449b251),
stored strokes, streamed changes and let viewers hide a painter locally. That
protected each person's marks, but it also kept painters apart. When I tried
to make a territory game from it, I had to reverse that rule. In
[`74094fd`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/74094fd),
I directed the agent toward a Splatoon-inspired contest with two teams, a
roller and rounds. I played it and found that it was still a drawing app with
a scoreboard: the cursor could paint anywhere, so position did not matter.

My next instruction was the decisive one: **the player is the roller**. In
[`9986c54`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/9986c54),
the agent replaced cursor painting with forward, back, left, right and still;
added bots for a quiet room; and removed rounds. I specified that choosing a
palette changes only the viewer's colours, not the two teams. Removing rounds
created a problem: permanent paint would fill the wall, but wall-clock fading
would erase it while Fly slept. The solution is a game clock that stops with
no human on the wall. The options and the cost of that choice are in
[`0003-the-world-freezes-when-empty.md`](docs/decisions/0003-the-world-freezes-when-empty.md).

The tilted view and blurred paint then failed my visual test. I wanted an
upright wall, almost face on, where wet paint could run downward. In
[`4178fb1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/4178fb1),
the client began outlining the server's ten-unit cells as sharp vector paths;
drips became server-simulated paint that changes the score. I had rejected an
earlier rounded-bar renderer because it made rows look like beads. I had also
rejected decorative, browser-only drips: the visible wall must agree with the
server's count. These corrections became rules in `CLAUDE.md` and checks in
`spec/grid.test.ts` and `spec/world.test.ts`. My role was to play each version,
notice the wrong interaction or image, and turn that observation into a rule
the agent could implement and verify.

## Stack and agent workflow

One small Fly machine and one persistent volume favoured a single Node 24
process. TypeScript runs with Node's type stripping, so I have no separate
compile-and-serve path. Built-in SQLite stores player identities, the painted
cell grid and the game clock on the volume. The server runs the world at 20 Hz
and sends positions, drips, changed cells and scores at 10 Hz through
server-sent events (SSE). Inputs travel in ordinary POST requests. SSE fits a
game where one server sends frequent updates to many viewers; WebSockets
would add a bidirectional channel without changing the five-action input
model. A browser canvas renders the world directly, without a UI framework.
The only runtime package, `marked`, renders the complete README at `/readme/`.

The server is authoritative. It moves each roller, assigns ownership and
counts the score; clients send actions, not painted pixels. That makes the
last-roller-wins rule deterministic even when two people cover one cell in the
same tick. It also means the player's own paint arrives after a round trip.
I accepted that delay rather than let a client claim arbitrary territory;
[`0002-last-roller-wins.md`](docs/decisions/0002-last-roller-wins.md)
compares the alternatives. The pure `server/grid.ts` and `server/world.ts`
modules let tests exercise ownership, fading, drips, collision and bots
without a network. `spec/turf.test.ts` then exercises real HTTP and SSE with
two players. I use `CLAUDE.md` to keep the agent from breaking the server's
authority, the stopped clock or the exact match between paint and score.

The harness also exposed mistakes in my checks. A round-era test once waited
into the next round and timed out even though the game worked; I reproduced
the boundary and changed the test's waiting window in
[`bd16ba0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/bd16ba0).
Later, a live timing check started its clock before the event stream connected.
Local connections hid the error; a remote run did not. In
[`12449e7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/12449e7)
I changed it to wait for an open stream before timing a move. This does not
remove real network latency, but it makes the test measure the promised
delivery rather than connection setup. A Node startup failure from an
unsupported TypeScript parameter property led me to enable
`erasableSyntaxOnly`, so type checking now catches that syntax before boot.

## Making two players legible

For crit 10, two browsers could already see and change the same wall, but the
server could not tell their story from its logs. In
[`f258793`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/f258793),
the server began writing one structured line for each arrival, departure,
rename, changed action and denied action, including a stable user ID, tag and
team. It omits bearer secrets and repeated input heartbeats. The same change
added a two-player regression: a forged player ID in a request body still
changes only the credential's owner, while an unauthenticated mutation gets
401. The [identity decision](docs/decisions/0004-browser-identity-and-authority.md)
records why I chose anonymous browser identity over accounts and what that
choice cannot prove. I then used two live sessions to confirm the Fly logs
attributed their actions to separate IDs; the documented C10 run,
[`5505021`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/commit/5505021),
records that deployed rehearsal.

## What remains to judge

The automated checks cover the rules and a local sub-second stream, and the
deployed rehearsal covers two distinct identities. They do not decide whether
the roller feels responsive to a newcomer on a phone or whether a busy wall is
still readable. I judged the earlier versions by playing them and checking
desktop and touch screenshots; the final version still needs a fresh
two-person field test. Persistence has a deliberate limit: the floor is saved
every five seconds and on clean shutdown, so an abrupt crash can lose up to
five seconds of paint. A manual stop/start restored the clock and score; a
next-day return after an actual Fly restart remains to be checked before the
final deadline. I would rather state those limits than claim that a green
check alone proves the experience is good.
