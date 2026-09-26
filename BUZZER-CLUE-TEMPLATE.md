# The Buzzer — how to write the clues

520 clues, 104 categories, five each. This is the format, the rules, and the
source material. Everything here is checkable by machine except whether an
answer is actually true, which is the part that needs a person.

## The four files

| File | What it is |
|---|---|
| `buzzer-scopes.json` | **All 104 categories with a scope and a decoy family.** The thing to write from. |
| `buzzer-source-arena.md` | The actual code, pulled out of the repo, for the 12 arena categories. |
| `buzzer-clues-arena.json` | 50 clues already drafted, as a worked example. Unverified. |
| `scripts/buzzer-bank-check.mjs` | Run your output through this before sending it back. |

```bash
node scripts/buzzer-bank-check.mjs path/to/your-clues.json
```

## The shape

```json
[
  {
    "id": "planets",
    "name": "PLANETS & MOONS",
    "section": "science",
    "scope": "Every answer is a planet, a moon or a dwarf planet.",
    "clues": [
      {
        "row": 1,
        "q": "The only planet not named for a Roman god",
        "a": "Earth",
        "wrong": ["Mars", "Venus", "Neptune"]
      }
    ]
  }
]
```

`row` is 1 to 5 and sets the value: $200, $400, $600, $800, $1,000. Arena
categories also carry `"source": "file.js:123"`.

## The one rule that matters

**The three wrong options must come from the same family as the answer.**

This is not a style preference, it is what makes the game work. A player who
buzzes without knowing gets one chance in four, and a wrong answer costs
exactly what a right one pays — so a blind buzz is worth minus half the
value, and guessing punishes itself with no special rule needed. That whole
structure collapses the moment the decoys are obviously wrong, because then
the options are a free answer and the only skill left is a fast thumb.

Every category in `buzzer-scopes.json` carries a `decoys` line saying where
its wrong options come from. Use it.

```
GOOD   a: "Destroyer"   wrong: ["Carrier", "Cruiser", "Submarine"]
       Four ships. You have to know which one is two cells.

BAD    a: "Destroyer"   wrong: ["Tuesday", "Bratislava", "photosynthesis"]
       One option is a ship. No knowledge required.
```

Two categories are flagged `FRAGILE` in the scopes file, and they are the two
that nearly did not survive drafting:

- **POTPOURRI** works only because every answer is secretly an ordinary
  household object. The subjects roam; the answers never leave the house. The
  night somebody writes a clue whose answer is a person, the column has no
  decoys and breaks.
- **DYNAMIC DUOS** needs its pairs to stay one kind. Comedy duos and chemical
  pairs in one column cannot supply each other's decoys.

A third, **THE COMMONS**, was cut outright during drafting for exactly this
fault — its answers were UI panels rather than a family, so the same three
decoys came round at both ends of the column. It was replaced by
**AND THEY'RE OFF!**, which has fourteen real members in two families.

## The other rules

- **Write a statement, not a question.** "The smallest hull in the fleet, at
  two cells" — never "What is the smallest ship?" and never a question mark.
  This is most of what makes a board sound like the real thing.
- **Under 150 characters.** Reading time is scaled to length, and a clue that
  takes nine seconds to read is a clue nobody enjoys.
- **The answer is short** — a name, a number, a phrase. Not a sentence.
- **Difficulty must climb.** Row 1 is something anybody who has played once
  knows. Row 5 is something only a regular knows. A flat column is a wasted
  category.
- **No answer repeats inside a column**, and no clue gives away another's
  answer.
- **Keep the options similar in shape.** If the answer is two words and the
  three decoys are one word each, the shape gives it away without any
  knowledge at all. The checker warns about this.

## The arena categories, and why they are different

Twelve categories are about this arena. Their answers must be true **of the
code as it stands**, so write them from `buzzer-source-arena.md`, which is the
actual source pulled out of the repo — not from the rule sheets.

`public/game-modes.js` is player-facing prose and is **known to be wrong**
about the horse race. It describes four suits over seven steps and a first-
place bet paying 3:1. The code has seven horses, all Spades, and pays 20.

There is a live trap in that file, and it caught the first drafting round
twice:

```js
const PRICES = { place: 4, win: 20, exacta: 150, trifecta: 400,
                 superfecta: 1000, long: 100, short: 50 };

export const BETS = [
  { id: "place", name: "1st or 2nd", pays: 3.5, ... },   // <- overwritten to 4
  ...
  { id: "long", name: "The Long", pays: 50, ... },       // <- overwritten to 100
];
```

**The loop wins.** A clue written from the `BETS` literal is wrong. Where a
literal and the program disagree, cite the line that actually decides, and
say so in `source`.

The first drafting round produced four wrong answers out of about twenty
sampled, and the two above were among them. That is why every arena clue
carries a `source`: a quiz about this codebase should be able to say where it
got its answers, or it will confidently teach people something the program
stopped doing two releases ago.

**Two arena categories are not written at all** — BELTS & BRASS and
THE BOUNTY OFFICE. Their source is in the pack.

**Three answers in the existing drafts are suspect** and want checking before
they ship:

1. **TOKENS & ARSENALS row 4** says six battleship tokens carry no `max`.
   Separate reconnaissance of the same file said four. One is wrong.
2. **THE KART GARAGE row 1** answers "Formula" for `DEFAULT_KART = "f1"`.
   Confirm the display name, and confirm Saloon / Taxi / Estate are real karts
   rather than invented decoys.
3. **BATTLESHIP ROYALE row 5** gives the Submarine Torpedo an unrounded price
   of "143", which looks like a misread line number.

## Worked example, from the drafted set

```json
{
  "id": "horses",
  "name": "AND THEY'RE OFF!",
  "section": "arena",
  "scope": "Every answer is one of the seven horses (all Spades) or one of the seven bets on the race card.",
  "clues": [
    { "row": 1,
      "q": "Every runner in the seven-horse field wears this one suit",
      "a": "Spades",
      "wrong": ["Hearts", "Diamonds", "Clubs"],
      "source": "src/casino-core.js:40-48" },
    { "row": 5,
      "q": "At a hundred to one it pays twice what its opposite number does, and it wants your horse home by three clear steps",
      "a": "The Long",
      "wrong": ["The Short", "First Place", "Exacta"],
      "source": "src/casino-core.js:150 (PRICES.long = 100; the BETS literal says 50 and is overwritten)" }
  ]
}
```

Row 1 is visible the moment the card is dealt. Row 5 is a price only a bettor
knows. Both draw their decoys from the same family, and the harder one names
the line that actually decides.

## Three categories that need no clues at all

Memory, Mental Arithmetic and Scrambled generate their own, on the Grand
Prix's existing engines. They sit **alongside** the 104 rather than among
them, because they break the buzzer on purpose: a sequence has to be watched
by everybody before anybody can answer, so a generated row is played by the
whole table at once. At most one on a board.

## Order to write in

1. **BELTS & BRASS** and **THE BOUNTY OFFICE** — the two missing arena
   columns. Source is in the pack; these can be written today.
2. The three suspect answers above.
3. **The staples** (12) — most frequent on the real show, so most valuable.
4. Everything else, section by section.

A game uses twelve categories, six a round. The bank has ten. So the first
twelve is the point at which two full rounds stop repeating.
