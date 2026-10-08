# Working in Kotoba Dojo

A browser game arena on Cloudflare Workers and Durable Objects (`src/` is the
server, `public/` is the browser). Players are on phones as much as computers.

## Where your work goes (the rule that matters most)

Every fix or feature goes to GitHub, where it can be found and reviewed. Work
that exists only on this computer is invisible to everyone else.

1. **One branch per fix or feature**, named `copilot/<short-topic>`, for example
   `copilot/buzzer-timer-fix`. Start it from an up-to-date `master`.
2. **Commit** with a message that says what changed and why.
3. **Push the branch.** Never leave changes uncommitted or unpushed at the end of a task.
4. **Open a pull request** (a draft is fine) against `master`. The description says:
   what changed, which files, how it was tested, and anything that behaves differently.
5. **Do not merge to `master` and do not deploy.** A person reviews first.
6. One topic per branch. Do not mix unrelated fixes in one pull request.

## Before you push

- Run `npm test`. It must pass, and the pull request should say so.
- Add or update a test for what you changed, in `scripts/`, and add it to the
  `test` chain in `package.json`. Prove a new test can fail before trusting it.
- Never commit secrets: `.dev.vars`, `.env`, or any service-account JSON.
  They are git-ignored; keep it that way.
- Do not edit `public/version.json` or the `<meta name="build">` in
  `public/index.html` by hand. `npm run deploy` stamps both together.
- Do not run `npm run deploy` or `wrangler deploy`.

## How the code is arranged

- Each game has a Durable Object room (`src/*-room.js`, `*-lobby.js`) and a
  browser screen (`public/<game>.js`). The server runs every rule; the browser
  only draws what the room sends. Secrets such as answers are never sent.
- A room tells the directory it exists through `announceRoom` in `src/rooms.js`.
  A room is only ever announced as the game it is: a missing or unknown game id
  must be refused and reported, never replaced with a guess.
- Match scores, MMR and tokens go through `src/mmr.js`, `src/boost.js` and
  `src/firestore.js`. Do not duplicate that arithmetic in a game.
- Keep new code in the style of its neighbours: same comment density, naming
  and idiom. Many files use Windows line endings; leave them as they are.

## When you report back

Say plainly what you changed, what you tested, and what you did not or could not
test (for example, signed-in play or a real phone). Do not describe a check you
did not run.
