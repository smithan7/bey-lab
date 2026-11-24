# Find a combo's spot: who to battle to see if it makes the best deck

Date: 2026-11-24. Status: draft. Builds on `2026-11-18-next-upset-design.md`.

## Why
The son has specific combos he wants to test, usually new ones, and wants to know whether they
can make it into the top 3. "Top 3" means **the best deck**: the legal three with the highest
summed rating (no repeated parts). Next answers "which matchup could change the deck?" across
every combo. This answers the same question for **one combo he picks**.

## Goals / non-goals
- Goal: for a chosen combo X, suggest the opponents whose next 10 battles are most likely to
  settle whether X is in or out of the best deck, with a plain reason for each.
- Goal: works for a brand-new combo with zero battles.
- Non-goal: changing the Next tab, the ratings, or the Lineup simulation.
- Anti-goal: suggesting a matchup he can't physically build (a shared part he has only one of),
  or confusing "rated #2" with "in the deck" without saying why.

## Approaches
1. **Targeted look-ahead (chosen).** The Next tab's exact look-ahead maths, restricted to
   matchups involving X, measuring the chance that X's deck membership flips. Fast, and
   consistent with Next.
2. Opponents rated closest to the deck line. Easy to explain, but ignores uncertainty and the
   deck rules.
3. The full match simulation per opponent. Several seconds each on the iPad, and not much
   better for this question.

## Design

### Maths (new pure function `spotTests(state, parts, x, { k = 3, n = 10 })` in suggest.js)
- Fit the ridge model with X included even if it has no battles (`fitModel` gains an
  `extraIds` option: a combo with no battles gets only the λ diagonal, so its rating starts at 0
  with a wide range).
- Candidate deck members: `candidateCombos` plus X. Decks: the 200 highest-summed legal decks
  **plus** the 50 highest-summed legal decks that contain X, so X's best case is always
  considered even when it is rated low.
- Status now: X is **in** if it's in the top deck, else **out**.
- Opponents B: tested combos, fully owned, `blockingParts(X, B)` empty, B ≠ X. Deck-mates are
  allowed (battling them still moves X's rating).
- For each B: as in Next, every deck's summed rating after the batch is a line
  `s_d + kz · U_d · z` in one standard-normal z. Take the upper envelope of those lines. **p_flip**
  = the probability mass of the z where the envelope's top deck has X's status flipped
  (in → out or out → in).
- Ranking: p_flip highest first. Opponents with p_flip < 2% are ranked after those, by how much
  the batch narrows `r_X − r_T`: `σ² n (cᵀu)² / (1 + n q)` with `c = e_X − e_T`. T is the
  deck's weakest member when X is out, or the strongest combo that could take X's place when
  X is in.
- Returns `{ status, rank, blockedBy, tests: [{ b, p, n, reason }] }`, where rank is X's place
  in the ratings list, blockedBy lists the parts that keep a higher-rated X out of the deck, and
  n is the battles X and B already have.

### Reasons (full combo names)
- Out, p ≥ 2%: "If it does well, 28% chance 10 battles against Cobalt Drake 1-60 Free Flat
  put it in your best deck."
- In, p ≥ 2%: "28% chance 10 battles against … knock it out of your best deck if it does badly."
- p < 2%: "Unlikely to change its spot either way. This one narrows its rating the most."
- Plus "They haven't battled yet" or "N battles between them so far."

### Status line (top of both UIs)
- "In your best deck (rated #2)." / "Not in your best deck yet (rated #6)."
- Rated high but blocked: "Rated #2, but it shares 1-60 with Wizard Rod 2-60 Gear Ball, so
  they can't both be in the deck."
- Untested: "Not tested yet. These battles will show where it fits."
- X has parts not marked owned: it's treated as owned for this question, with a note to mark
  the parts owned.

### UI
- **Combo card (Combos tab):** a "Find its spot" button next to "Suggest 3 variants". It opens a
  sheet with the status line and up to 3 opponents (photos, name, reason, a "Battle" button
  that opens the Battle tab with X on the left and B on the right).
- **Battle tab:** under the two combo cards, a button "Who should ⟨left combo⟩ battle next?"
  (shown when a left combo is picked). It sets the right combo to the top suggestion and shows
  the status line and the reason above "This pairing". It re-runs after each set of 10, so he can
  keep tapping it.
- No opponent available: "Nothing it can be built alongside has been tested yet."

### Testing
Unit tests on synthetic battles: a clearly weak X gets low p and the narrowing fallback; a
near-the-line X gets p > 2% against the right opponents; an untested X gets suggestions; an X
blocked by a shared part reports blockedBy; blocking opponents are never suggested; a combo
already in the deck reports "in". UI smoke check on the newest backup in `backups/`.

## Calls (mine; check them)
- Opponents must be fully owned and tested; untested opponents are never suggested.
- Batch size stays 10, same as everywhere else.
- Builds on `feat/variant-compare` (not merged yet), so both ship together.
- Bump `CACHE_VERSION` in `app/sw.js`.
