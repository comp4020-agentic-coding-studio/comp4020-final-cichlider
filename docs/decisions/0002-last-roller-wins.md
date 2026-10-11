# Decision record 2: when two teams paint the same floor, the last roller wins

*Crit 9. Status: accepted.* (Decision record 1, the stack, is in `PROCESS.md`.)

## Context

Turf war is a game about several people painting the same floor at once, so the
question crit 9 asks — what happens when two people change the same thing at
the same time — isn't an edge case here. It *is* the game. Every second of a
round, players from both teams are rolling over cells the other team owns, and
sometimes two rollers cross the same cell within a few milliseconds of each
other.

The score is the share of the floor each team owns when the clock runs out, so
whatever rule decides who owns a contested cell decides who wins.

The forces:

- **The score has to read at a glance.** A player should be able to look at the
  floor and know who's ahead, and know that what they see is what's scored.
- **Painting over the other team has to feel good.** That's the verb the game
  is built around.
- **One small machine, one process.** No consensus protocol, no CRDT library;
  whatever the rule is, it has to be cheap to apply on every stroke.

## Options

**A. Last roller wins.** A cell belongs to the team whose stroke covered it
most recently, as the server receives strokes. A later stroke overwrites, fully,
whatever was there.

**B. First painter holds it.** A painted cell is locked to its team for the
round (or for some seconds). Others can only paint bare floor.

**C. Blend.** Contested cells take a mix — either a literal blended colour, or a
tug-of-war value that each stroke nudges toward its team, scored as a fraction.

**D. Last *by the client's clock* wins.** Each stroke carries the time the
player drew it, and the server orders by that instead of by arrival.

## Decision

**A: last roller wins, ordered by arrival at the server.**

It is what Splatoon does, and it's the rule that makes painting over the other
team the main thing you do rather than something the game resists. It's also
the only one where the picture *is* the score: strokes are drawn oldest-first,
so the colour on top of any spot is exactly the team the grid says owns it
(`server/grid.ts`, checked by `spec/grid.test.ts`).

Ordering by arrival means the server never has to arbitrate. Node handles one
request at a time, SQLite serialises the insert, and the in-memory grid is
updated in the same step, so "last" is simply "processed second". Every client
sees strokes in that same order because they all come down the same event
stream.

## What it costs

- **A lucky late stroke can erase a lot of work.** A long sweep at the last
  second can flip a region someone spent twenty seconds on. That's partly the
  point (comebacks), but it can feel unfair. The ink tank is the brake: a sweep
  costs ink by distance, so you can't erase the whole floor in one go
  (`server/main.ts`, `INK_MAX`).
- **Latency decides close calls.** If two players cross a cell within a few
  tens of milliseconds, the one with the faster connection wins it. Option D
  would fix that, but it means trusting a client-supplied timestamp, and anyone
  could claim their stroke happened in the future. For cells that will be
  painted over again within seconds anyway, a few milliseconds of network
  unfairness is the better trade.
- **No history of who painted what.** With B or C, early work leaves a trace.
  With A, a cell remembers only its latest owner. Paint is per round and
  discarded once the round is scored; the result row is what persists.
- **There's no "my mark" any more.** This reverses the wall's founding rule from
  crit 8 (nobody can ever cover anybody else). That rule made sense for a shared
  artwork. It's the opposite of what a game of territory needs, so it's gone —
  see the rewritten `CLAUDE.md`.

## Why not the others

- **B (first holds)** makes the opening seconds decide the round: whoever
  spreads fastest at the start locks in the lead, and the rest of the round is
  painting leftovers. No comebacks, no front line.
- **C (blend)** makes the floor unreadable. A patch of muddy half-pink-half-lime
  doesn't tell you who's winning, and fractional ownership is harder to explain
  than "the colour you see is who owns it."
- **D (client clock)** is fairer on paper and cheatable in practice.
