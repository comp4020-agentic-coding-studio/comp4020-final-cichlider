# The Wall

One very large wall that anyone can paint on, together, live. Open it, get a
tag, pick up a spray can, and paint. Everyone else who's here is painting at
the same time: you see their cursors, and their strokes grow on your screen as
they draw them. When you've had enough of one patch, wander off to another;
the wall is big enough that there's always empty brick somewhere.

Live at <https://comp4020-final-cichlider.fly.dev>.

## What good means for this wall

*First version, written for crit 8. It will change as the wall gets used.*

A real graffiti wall is good when it's **crowded but not ruined**: lots of
people have left something, you can tell their marks apart, and you can still
find a spot of your own. Online shared canvases tend to fail one of two ways.
Either they're so open that one person can bury everybody (or a script can), or
they're so locked down — rooms, accounts, moderation queues — that they stop
feeling like a wall. Good, for this app, means holding the middle:

1. **Anyone can leave a mark in under ten seconds.** No sign-up. You arrive with
   a tag (`neon-drip`, `rusty-kite`) that you can rename, and that's who you are
   on this device.
2. **Being here at the same time is the point.** You see other people's cursors
   and their strokes as they draw them, not after. Painting next to someone is
   more interesting than painting alone, so the wall should make you notice them.
3. **Your mark stays.** What you paint is still there tomorrow, after restarts
   and redeploys, exactly as you left it — the same spray dots, not a re-roll.
4. **Nobody can erase you, but you don't have to look at them.** You can only
   take back your *own* marks. If someone's work is in the way of what you want
   to see, you hide them *for yourself*: the wall stays shared, and your view
   becomes yours. This is the decision the whole app turns on — the real-wall
   equivalent is painting over (the *buff* tool does that, and it's honest
   about it: it's just more paint, credited to you).
5. **The tools are worth picking up.** Enough range to make something you're
   proud of — pen, marker, a brush that swells and thins with your speed, a
   spray can, lines, boxes, ellipses, any colour — without a toolbar that
   needs a manual.
6. **There's always somewhere to go.** The wall is effectively unbounded. 🔥
   takes you to where people have been painting; ⬚ finds a fresh patch.

### What I deliberately didn't build

- **Accounts, profiles, likes, follower counts.** A wall has tags, not profiles.
- **Moderation by deletion.** No one, including me, has a "remove other
  people's marks" button in the app. Per-viewer hiding is the answer to "I
  don't want to see that." (If something genuinely harmful appears, that's an
  operator problem handled outside the app, not a feature.)
- **Rooms or private walls.** One wall. Splitting it would kill the co-presence
  that makes it worth opening.
- **Chat.** You talk by painting next to each other.

### Which claims are checked, and which are judged

| Claim | How it's held |
| --- | --- |
| A stranger gets a tag with no sign-up, and keeps it on return | enforced: `spec/wall.test.ts` |
| A mark is still there when you come back | enforced: `spec/wall.test.ts` (and the database lives on the `/data` volume) |
| Another open session sees a new mark within a second | enforced: `spec/wall.test.ts` times it over the live event stream |
| You can't delete anyone else's mark | enforced: `spec/wall.test.ts` (403 for others, 401 for nobody) |
| Malformed or oversized marks are refused; nobody can flood the wall | enforced (shape): `spec/wall.test.ts`; rate limit is in `server/main.ts` |
| Hiding a painter only changes your own view | by construction: hiding is stored in your browser, never sent |
| The tools are worth picking up; the wall feels crowded but not ruined | **judged** — by watching my crit pod use it, and later at the showcase |

## What I read and looked at

- **r/place** (Reddit, 2017 and 2022) — a shared canvas where one pixel every
  few minutes forced cooperation. The rate limit made it a political game; I
  wanted the opposite feeling, closer to free painting, so the limit here is
  generous and only there to stop scripts.
- **Your World of Text** (yourworldoftext.com) — an infinite shared text grid.
  Showed me that "infinite" works if you give people a way to wander and a
  link to a spot.
- **Robin Sloan, "An app can be a home-cooked meal"** (2020) — software made
  for a small group doesn't need to scale or be a product. This wall is for a
  room full of people at the showcase, not for the internet.
- **Clay Shirky, "Situated Software"** (2004) — software designed for a
  specific social situation can lean on that situation instead of building
  features to replace it.
- **Actual legal graffiti walls** (e.g. Canberra's designated walls) — the
  etiquette there is the model: you can go over someone, but people notice, and
  there's always somewhere else to paint.

## How it's built

A single Node 24 process (TypeScript, run directly, no build step) serving a
plain-JavaScript canvas client. Strokes are stored as vector data in SQLite on
the Fly volume, and new strokes, in-progress strokes and cursors fan out to
everyone over server-sent events. `PROCESS.md` says why.

The first marks on the wall were painted by `scripts/seed.ts`, through the same
API anyone uses, under the tag **claude**. They're ordinary marks: hide them
like anyone else's.
