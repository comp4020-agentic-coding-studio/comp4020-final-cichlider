# Turf War

[Play Turf War](https://comp4020-final-cichlider.fly.dev). You are a paint roller
on an upright wall. Two teams share it. Roll over a patch to claim it, roll over
the other team's paint to take it, and keep moving: unrenewed paint fades.
Sometimes wet paint runs down the wall, and those drips count too. There is no
round timer or final victory screen. The contest is the changing wall itself.

The first visit gives you a tag and a team without an account. Select **Let's
roll**, then use W/S to move and A/D to turn (arrow keys also work); on a phone,
use the four visible buttons. The score bar counts the painted area of each
team. The palette picker changes only your view, so everyone still plays the
same two-team game.

## What good means here

**A good Turf War is legible within seconds and still worth moving through five
minutes later.** [Nintendo's Turf War](https://www.nintendo.com/au/games/nintendo-switch/splatoon-2/)
made coloured territory a readable objective, but its timed match and weapons
are more structure than this small shared wall needs. I kept the pleasure of
reclaiming ground and made the player the roller. You must travel to change a
place; clicking a distant spot cannot win it for you. The wall is also the
scoreboard: each patch has exactly one current owner, and the server counts the
same cells the browser draws. The later roller takes a contested patch, while
paint nobody renews fades after 75 seconds of **active play**. When the last
human leaves, the game clock and wall freeze. The next visitor returns to the
same contest instead of an empty reset. [The overwrite rule](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/docs/decisions/0002-last-roller-wins.md)
and [the stopped clock](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/docs/decisions/0003-the-world-freezes-when-empty.md)
record those choices and their costs.

This is built for a few people sharing a room, including someone who arrives
alone. Bots fill each team to three rollers and step aside as humans join.
[Robin Sloan's account of a home-cooked app](https://www.robinsloan.com/notes/home-cooked-app/)
helped me treat a small audience as a design decision rather than a shortfall.
The earlier [r/place canvas](https://redditinc.com/news/the-day-redditors-broke-the-internet-again)
showed how other people's marks can make a shared surface compelling; here,
overwriting and fading turn that shared surface into a continuing game.

## Promises and evidence

| Promise | How I check it |
| --- | --- |
| Two separate browsers can play together but cannot steer or rename one another | Server-side identity checks in [`spec/turf.test.ts`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/spec/turf.test.ts); [authority decision](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/docs/decisions/0004-browser-identity-and-authority.md) |
| Another open session sees a roller move within about a second | A timed live-stream check in `spec/turf.test.ts` |
| The painted wall and score agree, including drips, overwriting and fading | Pure rules in `spec/grid.test.ts` and `spec/world.test.ts`, plus server checks in `spec/turf.test.ts` |
| The wall survives a restart and stops ageing when empty | Save/restore check in `spec/grid.test.ts`; a manual restart and idle-clock check recorded in [`PROCESS.md`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/PROCESS.md) |
| Playing feels immediate and the territory remains readable | Judged by playing, watching the wall and checking the desktop and phone layouts; a fresh two-person field test remains to be done |

The browser holds a random player secret; the server uses it to authorise only
that player's actions. This allows instant entry, but it is a browser identity,
not an account across devices. The shared wall is public; there is no private
user content. I left out accounts, ranks, weapons and knockouts because they
would distract from movement, paint and co-presence. The app runs on one Node
process with SQLite on Fly's persistent volume and server-sent events for live
updates. [`PROCESS.md`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-cichlider/blob/main/PROCESS.md)
explains why I chose that stack and how the game reached this version.
