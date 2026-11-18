# Next tab: suggest the matchups most likely to change the best deck

Date: 2026-11-18. Status: approved. Builds on `2026-11-18-ev-ratings-design.md`.

## Why
The user wants Next to drive down the uncertainty that matters: which matchup is most likely to
upset the current top 3. The kind-ordered list (contender, top deck, narrow) didn't answer that.

## Approaches
- A. Per-combo upset odds (chance a combo truly belongs in / out of the best deck). Simple, but
  blind to matchups that shift several ratings at once.
- **B. Look-ahead (chosen).** For each buildable matchup, consider the likely results of 10
  battles, update ratings, and compute the chance the best deck (legal three with the highest
  summed rating) changes. Exact and fast via a rank-one rating update.
- C. Look-ahead through the full match simulation. Too slow on the iPad.

## Design
- Next order: **New** (untested owned combos, ≤3, vs the strongest combo they share no parts
  with) → **Could change your best deck** (ordered by chance, shown if ≥ 2%) → **Fix** (≤2).
  Contender, Top deck and Narrow kinds are removed. The cap stays at 8.
- Eligible matchups: both combos rated and fully owned, sharing no parts.
- Maths: ridge model `A r = b`. Adding n = 10 battles of a vs b with mean s̄ moves the ratings by
  `r' = r + n/(1 + n q) · u · (s̄ − μ)`, where `x = e_a − e_b`, `u = A⁻¹x`, `q = xᵀu` and
  `μ = r_a − r_b`. The predictive distribution is `s̄ ~ N(μ, σ²(1/n + q))`. Every deck's summed
  rating moves linearly in one standard-normal z, so the chance that the best deck changes is
  `Φ(z_lo) + 1 − Φ(z_hi)`, from the crossing points against the current best deck. Decks are
  taken from the 200 highest-summed legal decks.
- Card text: chance, both combos' ratings with ranges, and the battles so far between them.
- When nothing reaches 2%, Next says the best deck is settled on current data.

## Calls (the builder's, approved)
- Only physically runnable matchups: both combos fully owned, with no shared parts.
- The look-ahead's best deck uses summed ratings, not the match simulation, so on close calls it
  can differ from the Lineup's #1.
- Ships together with the part photos and the no-shared-parts rule.
