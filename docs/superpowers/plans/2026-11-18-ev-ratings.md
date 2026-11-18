# EV Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank decks against all tested combos using EV ratings to fill untested matchups, and drive the Next tab from those ratings.

**Architecture:** A new pure `src/ratings.js` fits per-combo EV ratings (ridge least squares, centred). `src/matchups.js` gains rating-based pairing distributions (tilted pooled shape, blended with observed counts). `rankLineups` ranks rating-prefiltered legal decks with the existing simulator against a covering sample of opponent triples drawn from every tested combo. `suggestTests` is rebuilt around ratings. The UI drops the field.

**Tech Stack:** Vanilla ES modules, `node --test`, module worker, IndexedDB store, service worker cache.

**Spec:** `docs/superpowers/specs/2026-11-18-ev-ratings-design.md`

## Global Constraints

- Constants: `LAMBDA = 3`, `SIGMA2_FLOOR = 1.0`, `K_TESTED = 2`, `K_UNTESTED = 2`, `TILT_CLAMP = 2.5`, `PREFILTER = 60`, `MIN_OPP_DECKS = 20`, `TOP_N = 5`, `MAX_SUGGESTIONS = 8`, `MAX_SCREEN = 3`, `UNDER_TESTED = 5`. Keep `SCREEN_MATCHES 1000`, `REFINE_OUTER 200`, `REFINE_INNER 50`, `LEAD_MIN_GAIN 0.02`.
- Rated = combo with ≥1 non-mirror battle. Candidate = rated and all parts owned. Opponents = all rated combos.
- Ratings are displayed centred: mean of all rated combos = 0.
- Decks are ranked by mean first-to-5 P(win) (best estimate), never by the lower bound.
- No schema change except optional `combos[].createdAt` (ms). The `field` store keeps importing and exporting unchanged, but it's no longer read by ranking, suggestions or `lineupKey`.
- The opponent-sample shuffle uses a fixed seed (`OPP_SEED = 20261118`), not the data hash.
- Copy is plain English and says when results rest on estimates.
- Bump `sw.js` `CACHE_VERSION` and add `src/ratings.js` to `CORE`.

## Review Focus

1. **Fewer than 3 rated combos, or no legal candidate deck.** Lineup shows a clear "need at least 3 tested combos" or "no legal deck" message, and Next still offers Screen suggestions. Test in Task 3 and Task 4.
2. **A combo whose battles are all draws, or that has no decisive results.** Tilt falls back to the spin-only symmetric shape, with no NaN. Test in Task 2.
3. **Disconnected groups** (two sets of combos that never met). Ratings stay finite and centred, and there's no singular matrix. Test in Task 1.
4. **A candidate's own combo appearing in an opponent triple.** It uses the mirror distribution and isn't counted as estimated. Test in Task 3.
5. **An old backup containing `field` entries and no `createdAt`.** It imports cleanly, and Screen ordering treats missing `createdAt` as oldest. Test in Task 4 and Task 5.

---

### Task 1: EV ratings module

**Files:** Create `app/src/ratings.js`. Test `app/tests/ratings.test.js`.

**Interfaces:**
- Produces: `LAMBDA`, `SIGMA2_FLOOR`.
- Produces: `fitRatings(battles) → Map<comboId, { r, se, lo, hi, n, opponents }>`. `r` is centred. `lo`/`hi` = `r ∓ 1.96·se`. `n` = battle count, `opponents` = distinct opponents. Mirror battles are ignored. Score = `battleScore(b, left)` from `scoring.js`.
- Produces: `ratingsLeaderboard(state) → [{ comboId, r, se, lo, hi, n, opponents }]`, sorted by `r` descending.

- [ ] **Step 1: Write failing tests:**
  - `symmetric results give ratings of 0`: A beats B 5×+1, B beats A 5×+1 → |r| < 1e-9 for both.
  - `beating a strong combo rates higher than beating a weak one by the same margin`: pool where S beats W by +2 ×20. X beats S +1 ×10, Y beats W +1 ×10 → `r[X] > r[Y]`.
  - `one battle stays near 0 before centring effects`: X vs fresh Z once at +3 → |r[X] − r[Z]| < 3 and r[X] < 1.5.
  - `order independent`: shuffled battle order → identical r to 1e-12.
  - `se shrinks with more battles`: 4 vs 40 battles of the same pair → se smaller.
  - `centred`: mean r over all rated = 0 (1e-9).
  - `disconnected groups stay finite`: {A,B} and {C,D} never meet → all r finite and centred.
  - `heavily tested opponents barely move`: reproduce the spec example (Y and Z vs a 6-combo pool at 30 battles per pool combo) → Y's rating relative to the pool average drops < 0.1 when X beats Y +2 ×10.
- [ ] **Step 2:** Run `npm test` → new tests fail (module missing).
- [ ] **Step 3: Implement.** Build dense `A = λI + Σ xxᵀ`, `b = Σ s·x` per battle (`x` = +1 at left, −1 at right). Solve with Cholesky. `σ² = max(SIGMA2_FLOOR, RSS / max(1, N − m))`. `se_i = sqrt(σ² · (A⁻¹)_ii)`: compute A⁻¹ columns via the same Cholesky factor. Centre `r` by subtracting its mean.
- [ ] **Step 4:** `npm test` → pass.
- [ ] **Step 5:** Commit `feat(ratings): EV ratings fitted from all battles`.

### Task 2: Rating-based pairing distributions

**Files:** Modify `app/src/matchups.js`. Test `app/tests/matchups.test.js`.

**Interfaces:**
- Consumes: `fitRatings` result (a Map).
- Produces: `K_TESTED`, `K_UNTESTED`, `TILT_CLAMP`.
- Produces: `pooledShape(battles, a) → number[7]` (normalised, a's side; null if no decisive results).
- Produces: `tilt(shape, mean) → number[7]`.
- Produces: `predictedDistribution(battles, ratings, a, b) → number[7]`.
- Produces: `ratedDistribution(battles, ratings, a, b) → { counts: number[7], n, estimated: boolean }`. Mirror (`a === b`) returns the existing `pairingDistribution` mirror result with `estimated: false`.

- [ ] **Step 1: Write failing tests:**
  - `tilt hits the target mean`: for targets −2, 0, 1.3 on a mixed shape, the mean is within 1e-6.
  - `tilt clamps to ±2.5`: a target of 3 gives a mean of 2.5.
  - `predicted shape carries finish habits`: a burst-prone b gives more mass at +2 than a spin-only b at the same predicted mean.
  - `no decisive results falls back to spin-only`: all-draw combos → finite, mean = r[a] − r[b] (clamped).
  - `tested pairing adds K_TESTED pseudo-battles`: n = observed + 2, estimated false. With 50 observed battles the mean is within 0.1 of the observed EV.
  - `untested pairing is estimated`: n = 2, estimated true, the mean matches the rating difference.
  - `mirror is not estimated`.
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3: Implement.**
  - Shape for a vs b: mean of `pooledShape(a)` and the reverse of `pooledShape(b)`. Use only the one available if the other is null, or spin-only `[0,0,.5,0,.5,0,0]` if both are null.
  - Smooth by adding 0.02 to each outcome before tilting, so every outcome is reachable.
  - Tilt: `p_k ∝ shape_k · exp(θ·o_k)`, bisect θ in [−20, 20] for 60 iterations.
  - Predicted mean = `r[a] − r[b]` (0 if either is unrated), clamped to ±`TILT_CLAMP`.
- [ ] **Step 4:** `npm test` → pass.
- [ ] **Step 5:** Commit `feat(matchups): rating-based pairing distributions`.

### Task 3: Rank lineups against everyone

**Files:** Modify `app/src/lineup.js`, `app/src/lineup-worker.js` (unchanged API), `app/src/ui/lineup.js` (`lineupKey` only). Tests: rewrite `app/tests/lineup.test.js`, update `app/tests/lineup-key.test.js`.

**Interfaces:**
- Consumes: `fitRatings`, `ratedDistribution`.
- Produces: `opponentCombos(state) → string[]` (rated ids, in state.combos order).
- Produces: `coverDecks(ids, rng, min = MIN_OPP_DECKS) → string[][]`. Shuffle, chunk into disjoint triples (top up the last one from the shuffled head), then append fresh shuffled triples until `min` is reached or every 3-subset is used. No duplicate triples. [] if `ids.length < 3`.
- Produces: `candidateCombos(state, parts)` (unchanged).
- Produces: `rankLineups(state, parts, opts) → { ranked, tooFew, noLegal, ratings }`.
  - `ranked[i] = { deck, best, randomOrder, differs, estimatedShare }`, with `best` and `randomOrder` as today.
  - `tooFew` = fewer than 3 rated. `noLegal` = no legal candidate deck. `ratings` = the leaderboard array, so the UI and Next don't refit.
- Removes: `fieldCombos`, `fieldDecks`, `sampleFieldDecks`, `missingPairings`, `comboLeaderboard`, `blocked`, `fieldLegal`, `fieldTooSmall`, `BLOCKED_N`. Callers are updated in Tasks 4 and 6.
- `lineupKey(state, parts)` no longer includes `state.field`.

- [ ] **Step 1: Write failing tests** (keep the existing constants, lead and decideDiffers tests; replace field/blocked tests):
  - `coverDecks covers every id and is deterministic`: 10 ids → every id appears, ≥ 20 triples (or C(10,3) if smaller), no duplicates, same seed gives the same output.
  - `coverDecks with 3 ids gives one triple; fewer gives []`.
  - `a partly tested strong combo reaches the #1 deck`: synthetic 8 owned, legal combos. X has 10 battles at +2 vs the top-rated combo only → X is in `ranked[0].deck` and `estimatedShare > 0`.
  - `two lucky battles don't reach #1`: same setup, but X has 2 battles at +3 vs a weak combo → X not in `ranked[0].deck`.
  - `estimatedShare counts untested non-mirror pairings`: a hand-built state with a known answer.
  - `own combo in an opponent triple uses the mirror distribution`: rank a 4-combo state and assert no NaN, with estimatedShare excluding mirrors.
  - `tooFew and noLegal flags`: 2 rated → tooFew. 3 rated sharing a blade → noLegal. ranked = [] in both.
  - `ranked decks are legal and deterministic for a seed` (seed data plus synthetic).
  - `lineupKey ignores field edits` (in lineup-key.test.js).
  - `performance: 80 combos, 600 battles ranks in < 8000 ms with default constants` (synthetic; mark with a generous bound to avoid CI flakiness).
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3: Implement.**
  - Fit ratings once.
  - Opponent triples = `coverDecks(opponentCombos(state), makeRng(OPP_SEED))`.
  - Legal decks of candidates, prefiltered by summed `r` (top `PREFILTER`).
  - Matrix cell = `ratedDistribution(...)`.
  - Then today's screen → refine top `TOP_N` → decideLead → decideDiffers, unchanged.
  - Sort ranked by `best.target5.p` (mean).
  - estimatedShare = estimated cells / non-mirror cells across the deck's matrices.
- [ ] **Step 4:** `npm test` → pass (lineup tests). Other suites fail until Task 4 lands; that's expected.
- [ ] **Step 5:** Commit together with Task 4 if the suite isn't green in between.

### Task 4: Next suggestions from ratings

**Files:** Rewrite `app/src/suggest.js` (keep the `add`, `swapOptions` and narrow helpers). Test: rewrite `app/tests/suggest.test.js`.

**Interfaces:**
- Consumes: `rankLineups` result (`ranked`, `ratings`), `candidateCombos`, `opponentCombos`.
- Produces: `suggestTests(state, parts, lineupResult) → [{ kind, left, right, battles: 10, reason, replaces }]`.
  - Kinds, in this order: `screen`, `contender`, `topcheck`, `fix`, `narrow`.
  - `replacesInField` is removed, along with field-clash fixes and the `baseline`/`blocking`/`stage1`/`stage2` kinds.

- [ ] **Step 1: Write failing tests:**
  - `screen`: three untested owned combos with createdAt 1, 3 and missing → order 3, 1, missing. One suggestion each, at most 3 total even with 5 untested. Opponent = highest-rated with no shared parts, falling back to a clashing one with the "needs two of" note.
  - `untested combos with unowned parts are not screened`.
  - `contender`: a combo whose `hi` ≥ min `r` of the #1 deck members gets a suggestion vs the highest-rated opponent it hasn't faced. A combo whose `hi` is below gets none.
  - `contender who has faced everyone gets its least-tested opponent`.
  - `topcheck`: a #1 deck member with <5 battles vs a high-rated opponent is suggested. Ordered by opponent rating.
  - `fix only for #1 members and contenders`: a burst-prone low-ranked combo gets no fix.
  - `cap of 8, kind order, no duplicates, each suggestion valid` (keep the existing assertions).
  - `empty state yields no suggestions`.
  - `no ranked deck: every tested candidate is a contender, ordered by hi`.
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3: Implement.**
  - Threshold = min `r` of the `ranked[0].deck` members, or −Infinity when there's no ranked deck.
  - Narrow uses opponents = rated combos (replacing the field).
  - Reason copy:
    - Screen: "`X` hasn't been tested yet — start with the strongest combo it can face."
    - Contender: "`X` could make the best deck (rating `r` up to `hi`) but hasn't faced `Y`."
    - Topcheck: "`X` is in the best deck but has only `n` battles against `Y`, one of the strongest combos."
- [ ] **Step 4:** `npm test` → all green.
- [ ] **Step 5:** Commit `feat(lineup,suggest): rank against everyone with EV ratings`.

### Task 5: createdAt on new combos

**Files:** Modify `app/src/store.js` (`upsertCombo`). Test `app/tests/store.test.js`.

**Interfaces:** `upsertCombo(c)` sets `createdAt: Date.now()` when the combo is new and has none. On an update it keeps the existing `createdAt`. Import accepts combos with or without it.

- [ ] **Step 1: Write failing tests:**
  - `new combo gets createdAt`.
  - `update keeps the original createdAt`.
  - `import of a combo without createdAt succeeds and leaves it absent`.
- [ ] **Step 2:** `npm test` → fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → pass.
- [ ] **Step 5:** Commit `feat(store): record when a combo was created`.

### Task 6: UI — Lineup, Next, Combos; cache

**Files:** Modify `app/src/ui/lineup.js`, `app/src/ui/next.js`, `app/src/ui/combos.js`, `app/sw.js`, `README.md` (field wording). Test: existing UI-free tests stay green, and smoke test it in a browser.

- [ ] **Step 1: Lineup tab.**
  - Header: "Best decks against all tested combos. Percentages are P(win the match) with 95% intervals."
  - Per deck, add "Based on N% tested matchups", using the `flag` chip class when the estimated share is over 50%.
  - Remove the "Add to field" buttons, the field banners and the "Closest decks" section.
  - Messages: `tooFew` → "Test at least 3 combos to rank decks." `noLegal` → "No legal deck from your owned, tested combos yet."
  - Always render the leaderboard (`result.ratings`) with columns Combo, Rating [95%], Battles, Opponents. Untested owned combos go at the bottom as "not yet tested".
- [ ] **Step 2: Next tab.**
  - KIND labels: `screen` 'New', `contender` 'Contender', `topcheck` 'Top deck', `fix` 'Fix', `narrow` 'Narrow'.
  - Remove `swapInField` and its button.
- [ ] **Step 3: Combos tab.**
  - Order cards by rating, with a rating line "Rating +1.23 [+0.80, +1.66]".
  - The opponent table lists every combo faced. The overall row reads "Overall vs everyone faced".
  - Remove the "In field" and "Core" switches. Clash chips compare against the top 5 rated combos.
  - The just-built panel offers the top 3 rated combos (no shared parts first).
  - Delete-sheet copy: "Combos with battles can't be deleted, so test data is never lost. Low-rated combos simply stop being suggested for testing."
  - Update the header comment.
- [ ] **Step 4:** `sw.js`: `CACHE_VERSION = 'bey-lab-v8'` and add `'src/ratings.js'` to `CORE`. In `README.md`, replace field/core instructions with the ratings explanation.
- [ ] **Step 5:** `npm test` → green. Serve `app/` locally, then check each of Lineup, Next and Combos in the browser: renders, no console errors, and Start opens the Log.
- [ ] **Step 6:** Commit `feat(ui): ratings-based Lineup, Next and Combos; drop field switches`.
