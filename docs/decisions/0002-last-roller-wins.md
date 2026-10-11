# Decision record 2: when two teams roll over the same floor, the later roller wins

*Crit 9. Status: accepted, revised after the switch from a cursor-driven game
to one where you drive the roller.* (Decision record 1, the stack, is in
`PROCESS.md`.)

## Context

Turf war is several people painting the same floor at once, so the question
crit 9 asks (what happens when two people change the same thing at the same
time) isn't an edge case here. It *is* the game. All the time, rollers from
both teams cross cells the other team owns. Sometimes two rollers sit on the
same cell in the same tick.

The score is the share of the floor each team owns, so whatever rule decides
who owns a contested cell decides who's winning.

The forces:

- **The score has to read at a glance.** A player should be able to look at
  the floor and know who's ahead, and know that what they see is what's scored.
- **Painting over the other team has to feel good.** That's the verb the game
  is built around.
- **One small machine, one process.** No consensus protocol and no CRDT library.
  Whatever the rule is, it has to be cheap to apply 20 times a second for every
  roller.

## Options

**A. The later roller wins.** A cell belongs to the team whose roller covered
it most recently. Covering it overwrites, fully, whatever was there.

**B. First painter holds it.** A painted cell is locked to its team, for good
or for some seconds. Others can only paint bare floor.

**C. Blend.** Contested cells take a mix: either a literal blended colour, or a
tug-of-war value that each pass nudges toward a team, scored as a fraction.

**D. Each client paints, and reports what it covered.** Smoother on a laggy
connection, because your own paint appears instantly. The server then merges
the reports.

## Decision

**A: the later roller wins, and only the server paints.**

It is what Splatoon does, and it's the rule that makes rolling over the other
team the main thing you do rather than something the game resists. It's also
the only one where the picture *is* the score. Clients draw the server's own
grid, cell for cell (`server/grid.ts`, checked by `spec/grid.test.ts`).

Because only the server moves rollers and stamps paint, there's nothing to
arbitrate. Each tick it moves every roller in turn and stamps where each one
went, so "later" means "later in the tick order". If two rollers from opposite
teams sit on the same cell, the cell flickers between them until one drives
off. That's the visible version of a contested cell, and it's honest.

## What it costs

- **A late pass can erase a lot of work.** Driving through someone's territory
  flips a stripe of it. The brake is the roller itself: it moves at a fixed
  speed and paints a fixed width, so taking ground costs time and travel. And
  paint you don't renew fades anyway (decision record 3), so nothing anyone
  owns is permanent.
- **Your own paint lags behind your key press.** With only the server painting,
  you see your paint after a round trip and up to one 100 ms send. Option D
  would hide that, but it means trusting each client's account of what it
  covered, and anyone could claim the whole floor. For a slow, chunky roller, a
  short delay is the better trade.
- **No history of who painted what.** With B or C, early work leaves a trace.
  With A, a cell remembers only its latest owner and when it was last rolled
  over.
- **There's no "my mark" any more.** This reverses the wall's founding rule
  from crit 8 (nobody can ever cover anybody else). That rule made sense for a
  shared artwork. It's the opposite of what a game of territory needs, so it's
  gone. See the rewritten `CLAUDE.md`.

## Why not the others

- **B (first holds)** rewards whoever spreads fastest at the start. Once the
  floor is taken there's nothing left to do, which is the frozen board this
  game is designed to avoid.
- **C (blend)** makes the floor unreadable. A muddy patch of half one colour
  and half the other doesn't tell you who's winning, and fractional ownership
  is harder to explain than "the colour you see is who owns it."
- **D (client paints)** feels better on a bad connection and is trivially
  cheatable.
