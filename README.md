# Turf War

You're a paint roller. Two teams share one floor, seen from above at an angle.
Wherever you roll turns your team's colour, including over the other team's
paint. Paint nobody rolls over again slowly fades back to bare floor, so the
map never fills up and stays that way: you keep your turf fresh, and you take
theirs. There are no rounds and no clock. You drop in, roll for as long as you
like, and leave. When there aren't enough people, bots roll alongside you and
step aside as soon as someone joins.

Live at <https://comp4020-final-cichlider.fly.dev>.

*This started as The Wall, a free-painting graffiti wall (crit 8). In crit 9
week it became a game: first a round-based game you played with the cursor,
then this one, where you drive the roller itself. `PROCESS.md` has the whole
story.*

## What good means for turf war

*Third version, written for crit 9, after turning the roller into the player.*

A turf war is good when **the floor is always changing, and you can feel
yourself changing it.** Online territory games tend to fail in one of two ways:
either the board fills up and freezes, or it turns into noise and nobody can
tell who's winning or why. Good, for this game, means:

1. **You're rolling within ten seconds.** No sign-up, no lobby, no waiting for a
   round. You arrive with a tag and a team, and you're on the floor.
2. **You are the roller.** Five actions: forward, back, turn left, turn right,
   or stay put. No pointing and clicking at a spot across the map. Territory
   has to be travelled to, so position and route matter.
3. **The floor is the scoreboard.** The colour on any spot is the team that
   owns it, exactly as the server counts it. The bar at the top is the floor,
   counted.
4. **The later roller takes it.** Rolling over the other team's paint makes it
   yours. That's what keeps the front line moving. (The decision, the options
   and what it costs:
   [`docs/decisions/0002-last-roller-wins.md`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/docs/decisions/0002-last-roller-wins.md).)
5. **Turf has to be kept.** Paint fades after 75 seconds unless someone renews
   it, so nobody can paint the map once and walk away the winner. That replaces
   rounds: the game never needs to be reset, because it never stops moving.
6. **There's always a game on.** Bots fill each team up to three rollers. One
   person alone still has a match to play, and a full room plays without bots.
7. **What you leave is still there when you come back.** When the last person
   leaves, the world freezes: bots stop and paint stops fading. Come back
   tomorrow and the floor is exactly as it was left. (Why it's a game clock
   and not the wall clock:
   [`docs/decisions/0003-the-world-freezes-when-empty.md`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/docs/decisions/0003-the-world-freezes-when-empty.md).)
8. **The colours are yours.** There are four colour pairs, the same four my
   homepage uses, and you pick whichever you like. It only changes your screen.
   A team is a team, whatever colour you see it in.

### What I deliberately didn't build (yet)

- **Splatting other players.** Rollers bump into each other, but nobody gets
  knocked out. A respawn loop is the next layer of game, not the first.
- **Weapons beyond the roller.** One tool, done well, before a loadout.
- **Accounts, ranks and match history.** There's nothing to grind.
- **Free choice of colour.** You choose a *pair*, so colour still means team.

### Which claims are checked, and which are judged

| Claim | How it's held |
| --- | --- |
| A stranger gets a tag and a team with no sign-up, and keeps both on return | enforced: `spec/turf.test.ts` |
| A newcomer joins the side with fewer people on the floor right now | enforced: `spec/turf.test.ts` |
| Doing anything, even standing still, puts you on the floor as a roller | enforced: `spec/turf.test.ts` |
| The only actions are forward, back, left, right and still | enforced: `spec/turf.test.ts` (anything else is refused) and `spec/world.test.ts` (what each one does) |
| Another open session sees your roller move within a second | enforced: `spec/turf.test.ts` times it over the live event stream |
| The later roller over a cell owns it; cells are never counted twice | enforced: `spec/grid.test.ts` (the rule) and `spec/turf.test.ts` (end to end) |
| Paint fades after 75 s unless renewed, and nothing is shown past its fade | enforced: `spec/grid.test.ts`, `spec/turf.test.ts` |
| Bots fill each team to three, and only to three | enforced: `spec/world.test.ts`, `spec/turf.test.ts` |
| The world freezes when empty, and the floor survives a restart | `spec/grid.test.ts` checks a saved floor loads back exactly; the freeze and the restart are checked by hand (see `PROCESS.md`), since the spec can't stop the server |
| The floor is always changing, and you can feel yourself changing it | **judged**: by watching my crit pod play it |

## What I read and looked at

- **Splatoon** (Nintendo, 2015 onwards), Turf War mode. Paint is territory,
  later paint wins, and the score is the floor. The roller is Splatoon's
  simplest weapon. Here you don't carry it, you are it.
- **Tank controls**, from early 3D games like *Resident Evil* and *Battlezone*.
  Forward/back plus turning on the spot is the smallest action space that still
  needs skill. It also works on a phone with four buttons and no joystick.
- **Isometric games** (*Monument Valley*, *SimCity 2000*). A 2:1 isometric view
  of one raised slab gives the floor depth without a 3D engine.
- **r/place** (Reddit, 2017 and 2022). Overwriting is what creates the drama. I
  also took one lesson from how r/place ended: a canvas that only fills up ends
  up frozen. Fading is the answer here.
- **Robin Sloan, "An app can be a home-cooked meal"** (2020). This is for a room
  full of people at a crit or the showcase. One floor, always on, bots for the
  quiet moments.
- **My homepage's palettes.** Four pairs of one loud light colour and one deep
  dark one. The light colour is one team and the dark colour is the other.

## How it's built

A single Node 24 process (TypeScript, run directly, no build step) runs the
world at 20 ticks a second. It moves every roller according to its current
action, has the bots choose theirs, and stamps paint into a grid of 20-unit
cells. Ten times a second it sends everyone the rollers' positions and the
cells that changed, over server-sent events. Clients send only which of the
five actions they're doing. The browser draws the grid as an isometric floor on
a plain canvas. The floor and the game clock are saved to SQLite on the Fly
volume every few seconds. `PROCESS.md` has the reasons.
