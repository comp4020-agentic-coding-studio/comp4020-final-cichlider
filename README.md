# Turf War

Two teams, one floor, two and a half minutes. Open it and you're put on a team,
handed a roller, and dropped into whatever round is running. Roll your team's
colour over as much of the floor as you can, and over the other team's paint
too. When the clock runs out, the team whose colour covers more of the floor
wins. A few seconds later the floor is wiped and the next round starts.

Live at <https://comp4020-final-cichlider.fly.dev>.

*This used to be The Wall, a free-painting graffiti wall (crit 8). For crit 9 it
became a game. The real-time layer, the tags and the "nobody has to sign up"
promise carried over; the rest changed, and why is in `PROCESS.md`.*

## What good means for turf war

*Second version, written for crit 9, after deciding the wall should become a
game.*

A round of turf war is good when **it's close until the end, and you can feel
yourself changing the score.** Online territory games tend to fail in one of
two ways: either the first few seconds decide everything, or the floor turns
into noise and nobody can tell who's winning or why. Good, for this game, means:

1. **You're playing within ten seconds.** No sign-up and no lobby. You arrive
   with a tag and a team, and you join the round that's already running.
2. **The floor is the scoreboard.** The colour you see on any spot is the team
   that owns it, exactly. No blending and no hidden state. The bar at the top is
   just the floor, counted.
3. **Painting over them is the point.** A later roller takes the floor,
   whoever painted it before. That's what makes the front line move, and what
   makes a comeback possible. (The decision, the options and what it costs:
   [`docs/decisions/0002-last-roller-wins.md`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/docs/decisions/0002-last-roller-wins.md).)
4. **You can't win alone in one sweep.** Rolling drains an ink tank by distance,
   and it refills when you lift off. A rhythm of push, pause and push again
   means one fast player can't wipe the floor, and team-mates matter.
5. **The sides are even.** You join whichever team has fewer people playing
   *right now*, not fewer people ever.
6. **The round is short and the result is clear.** Two and a half minutes, a
   big winner banner, a few seconds to take it in, and then the next round.

### What I deliberately didn't build (yet)

- **Characters that move and can be splatted.** In Splatoon you're a squid on a
  map, not a cursor. That's a different game engine (movement, collision,
  respawn), and the cursor-and-roller version has to be fun first.
- **Weapons beyond the roller.** One tool, done well, before a loadout.
- **Accounts, ranks, match history pages.** Rounds are recorded on the server,
  but there's nothing to grind.
- **Picking your own colour.** Two team colours only. Colour means team.

### Which claims are checked, and which are judged

| Claim | How it's held |
| --- | --- |
| A stranger gets a tag and a team with no sign-up, and keeps both on return | enforced: `spec/turf.test.ts` |
| A newcomer joins the side with fewer players right now | enforced: `spec/turf.test.ts` |
| Another open session sees new paint within a second | enforced: `spec/turf.test.ts` times it over the live event stream |
| The last roller over a cell owns it; cells move between teams and are never counted twice | enforced: `spec/grid.test.ts` (the rule) and `spec/turf.test.ts` (end to end) |
| Your colour comes from your team, never from what the client sends | enforced: `spec/turf.test.ts` |
| A single stroke can't be longer than a full tank; malformed paint is refused | enforced: `spec/turf.test.ts` |
| A round in progress survives a restart, and a round that runs out is scored, recorded and replaced | checked by hand with short `ROUND_MS` (see `PROCESS.md`); the spec only checks the clock is consistent, since CI can't wait out a full round |
| It's close until the end, and painting over them feels good | **judged**: by watching my crit pod play it against each other |

## What I read and looked at

- **Splatoon** (Nintendo, 2015 onwards), Turf War mode specifically. The whole
  premise: paint is territory, the later paint wins, the score is the floor.
  The ink tank that empties as you paint and refills when you stop is from here
  too. I didn't copy the squid, the map or the weapons.
- **r/place** (Reddit, 2017 and 2022). A shared canvas where people fought over
  territory with a strict rate limit. It showed me that overwriting is what
  creates the drama, and that the rate limit sets the pace of the fight. Here
  the ink tank does that job.
- **Robin Sloan, "An app can be a home-cooked meal"** (2020). This is for a
  room full of people at a crit or the showcase, not for the internet. So: one
  arena, rounds that loop forever, no matchmaking.
- **Clay Shirky, "Situated Software"** (2004). The game leans on the room it's
  played in. The trash talk happens out loud, so there's no chat.

## How it's built

A single Node 24 process (TypeScript, run directly, no build step) serving a
plain-JavaScript canvas client. Each stroke of paint is stored as vector points
in SQLite on the Fly volume, tagged with its round and its painter's team. An
in-memory grid of 20-unit cells tracks who owns what, so the score is a counter
rather than a recount. New paint, cursors and round results reach everyone over
server-sent events. `PROCESS.md` has the reasons.
