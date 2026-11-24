# Find a Combo's Spot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For one chosen combo, suggest the opponents most likely to settle whether it's in the best deck, on the Combos card and the Battle tab.

**Architecture:** A new pure module `app/src/spot.js` reuses the ridge model (`fitModel`, now with `extraIds` for untested combos) and the Next look-ahead maths. For each opponent it builds an upper envelope over the deck lines to get the exact chance that the combo's deck membership flips. The UI calls it synchronously.

**Tech Stack:** Vanilla ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-combo-spot-design.md`

## Global Constraints
- Full blade names in all copy (e.g. "Pegasus Blast", never "Blast").
- Batch = 10 battles (`BATCH`); "likely" threshold = `UPSET_MIN` (2%); decks = top `LOOKAHEAD_DECKS` (200) + top 50 containing X.
- Never suggest an opponent with `blockingParts(X, B)` non-empty, untested, or not fully owned.
- DOM via `h()`/textContent only.
- Bump `CACHE_VERSION` in `app/sw.js` (v23 → v24).

## Review Focus
- X with zero battles: still gets ranked suggestions (test: untested X).
- X far below the line: every p < 2%, the fallback order is used, and the copy says "unlikely" (test: weak X).
- X rated above a deck member but sharing a part with it: status names the part and combo (test: blocked X).
- Only one or two candidates, or no legal deck containing X: no crash, empty or "out" (test: tiny pool).
- X deleted, or the left combo missing on the Battle tab: the button is hidden and spotTests returns null (test: unknown id).

---

### Task 1: `fitModel` extraIds
**Files:** Modify `app/src/ratings.js` (`fitModel`); test `app/tests/ratings.test.js`.
**Produces:** `fitModel(battles, { lambda, extraIds = [] })`. Extra ids are indexed after the battle ids, have r = 0 and n = 0, and their Ainv diagonal is 1/λ. With no battles but some extras, it returns a model, not null.
- [ ] Test `fitModel extraIds adds an untested combo without moving others`: ratings of existing ids are unchanged (< 1e-12), `r[idx(x)] === 0`, `Ainv[ix][ix] ≈ 1/LAMBDA`.
- [ ] Implement, then run `npm test` and commit.

### Task 2: `spotTests` + `spotStatus`
**Files:** Create `app/src/spot.js`; export `phi` from `app/src/suggest.js`; test `app/tests/spot.test.js`.
**Produces:**
- `spotTests(state, parts, x, { k = 3, n = BATCH }) → null | { status: 'in'|'out', rank, rated, untested, notOwned, blockedBy: [{ id, parts }], tests: [{ b, p, n, reason }] }`
- `spotStatus(result, combo label fn, partsById) → string`
- Envelope: sort lines (intercept s_d, slope kz·U_d) by slope, build the upper hull, and sum Φ mass over the segments whose deck membership differs from now.
- Fallback score `σ² n (u_X − u_T)² / (1 + n q)`. T = the weakest best-deck member when X is out, or the strongest non-member when X is in.
- [ ] Tests:
  - p_flip matches a brute-force sample of shifted ratings (as in suggest.test's look-ahead test), within 0.02.
  - Never suggests blocking, untested or self opponents.
  - Untested X gets k tests and `untested: true`.
  - Weak X: all p < UPSET_MIN, and the reason starts "Unlikely".
  - In-deck X reports `status: 'in'`.
  - Blocked X reports blockedBy.
  - Unknown id → null.
  - Tiny pool doesn't throw.
- [ ] Implement, then run `npm test` and commit.

### Task 3: UI
**Files:** Modify `app/src/ui/combos.js` ("Find its spot" button + sheet), `app/src/ui/log.js` ("Who should … battle next?" button + note), `app/styles.css` if needed, `app/sw.js`.
- [ ] Combo card: "Find its spot" next to "Suggest 3 variants". The sheet shows the status line and up to 3 cards (thumbs, name, reason, a "Battle" button that goes to `goTo('log', { left: X, right: B })`), or "Nothing it can be built alongside has been tested yet."
- [ ] Battle tab: when the left combo is set, a button `Who should ⟨label⟩ battle next?`. It sets the right combo to `tests[0].b`, and a session note (status + reason) shows above "This pairing" while left/right still match.
- [ ] Smoke run on the newest `backups/` file in Node (spotTests for each top combo), then `npm test`, then commit.

### Task 4: Ship
- [ ] Push the branch, open a PR, merge to main, then watch the Pages deploy.
