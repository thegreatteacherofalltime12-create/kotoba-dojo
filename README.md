# Kotoba Dojo

A competitive arena of three games, sharing one set of accounts, one belt
ladder and one MMR pipeline.

**Word Cross Challenges** — ten words, fifteen minutes. Everyone races the same
grid independently. Baseball and Football archives, 24 puzzles each, evenly
split across easy, medium and hard.

**Battleship Royale** — two shots a turn at one rival, and you must fire at
three other captains before returning to anyone. Solo against an AI at three
strengths, or up to eight players with optional anonymous play.

**Minesweeper** — everyone races the identical field. Clear it fastest, or get
as far as you can before one goes off. Best times per difficulty are kept.

**Casino** — horse racing and blackjack against the house, with a maths arcade
that pays MMR on a thirty-second clock. Cash and tokens are a separate economy
banked in a wallet; no casino game pays MMR, only the arcade.

Every game has a Solo toggle in its host panel, and every multiplayer result
banks MMR the same way.

**The bounty** rides on top of all of it. Win an eligible match and you wear a
target; the next player to out-earn your points-per-hour, or simply beat you
head to head, takes it and +50 MMR. Defending pays +25. Unclaimed for
forty-eight hours and it rotates to a random top-ten player.

**Themes** — fourteen palettes in Profile. A theme sets four colours and every
structural colour is derived from them, so contrast can't be set wrong. Boards
stay white in every theme.

## How the two platforms divide up

**Firebase** — Auth for identity. Firestore for everything that outlives a
match: profiles, saved puzzles, match history, leaderboard.

**Cloudflare** — Workers serve the client and verify tokens at the edge. One
Durable Object per lobby holds the roster, the round timer, the answer key and
every player's WebSocket. KV holds the curated puzzle archive.

Two consequences of that split are worth knowing before you read the code.

The Firebase Admin SDK does not run on Workers, so `src/jwt.js` verifies ID
tokens by hand: it pulls Google's JWK set, checks the RS256 signature with
WebCrypto, then checks `aud`, `iss` and `exp` itself. Nothing downstream ever
trusts a client-supplied uid.

For the same reason `src/firestore.js` talks to the Firestore REST API with a
service-account token it mints itself, rather than through the SDK. That
module is what writes match results, because a score a client reports about
itself is a claim rather than a result.

## Running it

This is a server application, not a page you can open from a folder. Double-
clicking `public/index.html` will show a blank screen: browsers block
JavaScript modules on `file://` URLs, and Firebase sign-in refuses to run from
a `file:` origin. Extract the zip properly first — browsing inside it in
Windows Explorer opens a read-only copy in your temp folder, which has the
same problem.

```bash
cd kotoba-dojo
npm install
npx wrangler dev
```

Open the `http://localhost:8787` address wrangler prints. Six puzzles are
built into the Worker, so the game is playable straight away — no KV setup
needed to try it.

You still need `public/firebase-config.js` filled in before anyone can sign
in. Until then the page says so in plain language rather than sitting blank.

Two people have to be in a lobby before the start button enables. Use a second
browser profile or an incognito window and join with the same code.

## Full setup

### 1. Firebase

- Create a project. Under Authentication → Sign-in method, enable
  **Email/Password** and **Anonymous**.
- Create a Firestore database.
- Project settings → Your apps → Web. Copy the config into
  `public/firebase-config.js`.
- Deploy the rules in `firestore.rules`.
- Add your Workers domain under Authentication → Settings → Authorized
  domains, or Google sign-in will fail with an unauthorized-domain error.

### 2. Cloudflare

Set `FIREBASE_PROJECT_ID` in `wrangler.toml` to your Firebase project id. That
one matters: it's what ID tokens are verified against.

The KV namespace is only needed once you want more than the six built-in
puzzles:

```bash
npx wrangler kv namespace create PUZZLES
```

Put the returned id into `wrangler.toml`.

### 3. Grow the puzzle archive

Six puzzles ship compiled into the Worker (`src/starter-puzzles.js`). KV takes
over as soon as it has content:

```bash
npm run seed              # builds 24 grids into dist/puzzles/
npm run kv:upload         # to your namespace, for the deployed Worker
npm run kv:upload:local   # to the store wrangler dev keeps on this machine
```

`scripts/word-bank.json` is where the words and clues live. Add sets to it and
re-run to grow the archive.

### 4. Server-side score writing (optional but recommended)

Firebase console → Project settings → Service accounts → Generate new private
key. Then:

```bash
# Pipe the file in. The interactive prompt reads a single line, so pasting a
# multi-line JSON key into it silently stores an empty string.
cat service-account.json | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT

# PowerShell:
#   Get-Content service-account.json -Raw | npx.cmd wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

Check it worked by opening the site and clicking "Why is this empty?" on the
Arena Rankings panel. It reports the real error from each step rather than
failing quietly.

Without this the game runs fine; you just get no match history or leaderboard.
There is no client-side fallback on purpose — a client-written leaderboard is
a leaderboard of whatever people felt like claiming.

### 5. Deploy

```bash
npx wrangler deploy
```

Local development: `npx wrangler dev`. Sign-in needs `localhost` in the
Firebase authorized-domain list.

## Bringing work in from a Claude chat

Do not unzip a chat's zip over the folder. The chat built it from whatever
version was uploaded to it, days ago, and every file in it is that old except
the ones the chat changed; dropping it in puts the rest of the project back
to that day. That has happened twice, once at twenty-four files.

Instead:

```bash
npm run import -- D:path	o	he-chat.zip
```

It reads the zip and, file by file, works out what the chat actually changed
and merges only that onto the current code. Files the chat left alone are
kept as they are here. A file the chat edited is three-way merged; a clean
merge is written in place, a conflict is written with `<<<<<<<` markers and
named in the summary for you to settle. A copy that mostly takes away is
treated as older than anything on record and kept current — the summary
names it with its numbers, and `--take <file>` merges it anyway if you know
you edited it. Nothing is committed and nothing is deployed; run `npm test`,
look over the result, then commit and `npm run deploy`.

## Adding a game

Codes come from one pool, so a code alone doesn't say which game it belongs
to. Every room registers its type with the directory, and the home screen asks
before it opens anything. Two places wire a new game:

1. Its Durable Object calls `announceRoom` from `src/rooms.js` whenever players
   join, the state changes, or someone leaves.
2. `GAME_MODES` in `public/arena.js` gains an entry with a `game` id, and
   `ROOMS` in `public/app.js` gains a line mapping that id to its opener.

`scripts/registry-test.mjs` fails if those two ever disagree, or if a room
stops announcing. An unrecognised game id is reported to the player rather than
falling back to the crossword — a silent fallback is what made battleship codes
open crosswords.

## Sign-in

Players choose a name and a six-digit pin. Firebase Auth has no
username/password mode, so a name maps to a fixed synthetic address
(`name@kotoba-dojo.local`) and Firebase's own uniqueness constraint on that
address is what stops two people taking the same name — no separate registry,
no race between checking and claiming.

Pins are deliberately not unique. A pin is a password scoped to one name.
Rejecting a duplicate would tell whoever typed it that someone else uses that
pin, and with a million possible pins collisions would start almost immediately.

A six-digit pin is weak, and this is worth being clear about: it is a
convenience for a word game among people who know each other, not a security
boundary. Firebase throttles repeated failures, which is the only thing
standing between a determined guesser and an account. There is also no
password reset, because there is no email address behind the account — a
forgotten pin means a new name. If this ever needs to guard anything that
matters, move to real email/password or a federated provider.

## Playing

Whoever opens a dojo is the sensei: they pick the scroll and call the start.
Open dojos are listed on the home screen and anyone signed in can walk into
any of them — there is no invitation and no code to share. Rounds run fifteen minutes,
grids are ten words, and the scoreboard fills in as people finish.

Scoring runs 1–100 on a curve set in `src/scoring.js`. Anything at or under
45 seconds scores 100, sliding to 1 at the buzzer; unfinished scores 0. That
45-second floor is a guess — once you have real solve times, move it so the
top of the range is reachable but rare.

## Writing your own puzzle

"Write a scroll" takes ten words and ten clues and interlocks them in the
browser as you type, so you find out immediately when a word shares no letters
with the rest and can swap it before you've committed. Saved scrolls live
under your own Firestore document and nobody else can read them.

An author knows every answer, so when a sensei runs their own scroll they
referee it instead of competing. Custom rounds also stay out of the
leaderboard — a sensei can simply tell a friend the answers beforehand, which
is fine among friends and fatal to a ranked ladder.

## Fairness, and where it stops

The answer key never leaves the Durable Object. Clients get grid geometry and
clues; each completed entry is checked over the socket, and only the DO knows
whether it was right. Checks are rate-limited so short entries can't be ground
out by brute force.

All timing is server-side. The DO stamps the start and stamps each finish;
client-reported times are ignored. Round-trip latency is noise against a
fifteen-minute round.

What this does not stop: someone solving with a second device, a friend in the
room, or a solver tool. Nothing server-side can, and it isn't worth
contorting the design over.

## Layout

```
src/index.js       Worker: routing, token check, hands off to the DO
src/lobby.js       DojoLobby — the whole state machine
src/jwt.js         Firebase ID token verification
src/validate.js    Independent re-check of any host-submitted grid
src/scoring.js     Curve and belt ranks
src/firestore.js   Server-side match history and leaderboard writes
public/            Client. No build step: plain modules, Firebase from CDN
public/layout.js   Crossword interlock, shared with the seed script
src/starter-puzzles.js  Six puzzles compiled in, so first run needs no setup
scripts/           Puzzle generator, KV uploader, word bank, smoke test
```

## Tests

```bash
node scripts/smoke-test.mjs
```

Runs the Durable Object against a stubbed Workers runtime: joining, the
sensei's permissions, solving and scoring, spectators, mid-round reconnects,
round end, rematches, leadership handover when a sensei leaves, rate limiting,
and rejection of tampered host-submitted grids.

## Lobby lifecycle

`LOBBY → ACTIVE → RESULTS → LOBBY`. The roster survives rounds; roles are
assigned fresh at each start.

- Arriving mid-round means spectating that one and playing the next.
- Reconnecting mid-round restores your grid, your solved entries and the real
  remaining time — everything is keyed by uid, not by connection.
- If the sensei disappears, the longest-standing member takes over. They can
  pick from the archive and from their own scrolls, not the old sensei's.
- Empty lobbies discard themselves after thirty minutes.

## Things left deliberately undone

- Puzzles come from a fixed word bank. A real archive wants curation.
- No spectator chat.
- Every dojo is public to anyone signed in. There is no private room.
- The profanity list in `src/validate.js` is a stub. If dojos ever become
  public rather than code-only, replace it before launch.
