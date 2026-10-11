# Decision record 3: the world runs on a game clock that stops when nobody's here

*Crit 9. Status: accepted.*

## Context

Paint fades: a cell nobody rolls over for 75 seconds goes back to bare floor.
That replaces rounds. It keeps the floor changing without ever resetting it.

But the final project also promises that what someone does persists: it's
still there when they, or anyone else, come back, across restarts and
redeploys. And the Fly machine stops itself when nobody is connected and starts
again on the next visit.

If paint faded by the wall clock, these two collide. Leave for five minutes and
everything you painted is gone. Leave overnight and the machine has been
stopped the whole time, and the floor is blank when it starts.

## Options

**A. Fade by the wall clock.** Simple and honest about time. The floor is
almost always empty for whoever arrives first.

**B. Don't fade at all while nobody's here, using a game clock.** The game has
its own clock, which only advances while at least one person is on the floor.
Paint ages in game time. NPCs only move while the clock runs.

**C. Never fade, reset on a schedule.** Persists, but brings rounds back.

## Decision

**B.** The clock runs while at least one person is on the floor. When the last
person leaves (they close the tab and stop sending input for 15 s), the clock
stops. Bots stop where they are, paint stops ageing, and the floor and the
clock are saved. After a restart, both load back and the clock carries on from
where it stopped.

## What it costs

- **"Fades after 75 seconds" means 75 seconds of play, not of real time.**
  That's a different promise, and the README says so.
- **One person keeps the whole world running.** A tab left open in a
  background window keeps the clock going and the bots painting. The client
  stops sending its heartbeat while its tab is hidden, so a forgotten tab
  leaves after 15 s.
- **The first arrival lands in the middle of the last game.** Bots stand where
  they froze. That's the point (it's still there), but it can look odd for the
  first second.
- **Up to five seconds of paint can be lost to a crash.** The floor is saved
  every five seconds and on a clean shutdown. A crash between saves loses that
  much paint. For a floor that fades anyway, that's an acceptable trade
  against writing on every tick.
