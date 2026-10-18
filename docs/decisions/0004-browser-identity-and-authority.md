# Decision 4: a browser is a player, but the server owns the roller

## Context

The crit puts two classmates in separate Chrome profiles and gives them only
the URL. They need to arrive without accounts, affect the same floor, and be
distinguishable in the game and in its logs. One person must not be able to
steer or rename another person's roller.

## Options

- **Accounts and passwords** would bind a player to a person across devices,
  but sign-up would break the game's ten-second arrival promise.
- **A name sent with each action** would be quick, but names can be copied and
  a browser could claim anyone else's name.
- **A random browser secret** makes each browser profile a distinct player
  without registration. It does not prove a human's identity; clearing storage
  creates a new player, and someone given the secret could impersonate them.

## Decision

The server creates a random secret and a persistent user row at `/api/session`.
The browser keeps the secret locally and sends it as a bearer credential for
`PATCH /api/me` and `POST /api/input`. The server resolves the user from that
credential and changes only that user's name or roller; a user ID in a request
body grants no authority. The server alone moves rollers, paints cells, assigns
teams, and counts the score. Anonymous viewers may read the shared floor and
live stream because the whole floor is intentionally public to players.

The server logs meaningful events with the stable user ID, visible tag and
team. It never logs the secret or an Authorization header. Repeated heartbeat
inputs and simulation ticks are not logged; action changes, arrivals,
departures and renames are enough to tell the two players' stories without
burying them in noise.

## Consequences and checks

This supports instant play and separate Chrome profiles, but it is
pseudonymous browser identity, not account security. Private user content is
out of scope for this shared-floor game. `spec/turf.test.ts` creates two
players, checks that a body claiming the other's ID changes only the
credential's owner, and checks that unauthenticated mutations are refused.
The live crit rehearsal checks that Fly's server log shows two distinct IDs
while both people use the same floor.
