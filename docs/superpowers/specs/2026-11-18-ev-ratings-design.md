# EV ratings: rank decks against everyone, with partial data

Date: 2026-11-18. Status: draft for approval. Builds on `docs/2026-11-06-bey-lab-design.md`.

## Why

The user has added many new combos, some clearly good, but the app is slow to surface them:

- A deck is only ranked when every member has battled every field combo ("all or nothing"). As
  the combo count grows, this becomes an impossible testing burden, and a promising but partly
  tested combo never reaches the Lineup.
- Opponents are a hand-picked "field". The user wants a combo judged by its ability to beat
  **everyone**: all other tested combos, equally weighted.
- Next suggestions are ordered by stage and by storage order, not by what would most change the
  best deck. Untested combos are never suggested.

The user's idea: a chess-style rating, where beating a strong combo counts for more than beating a
weak one, based on **points (EV), not win/loss**. A rating must reflect results against the whole
pool, so one upset over a strong combo can't hide losses to everyone else.

## Goals

- Every combo with at least one battle gets an **EV rating** with an uncertainty range.
- The Lineup ranks legal decks of owned, tested combos against **all tested combos**, using real
  results where they exist and rating-based estimates where they don't. No all-or-nothing rule.
- Next suggests the battles most likely to change the best deck, including first battles for
  untested owned combos.
- Results are honest about how much rests on estimates.

## Non-goals

- Counter or type adjustments (attack vs stamina, etc.): option C, rejected for now, since it
  needs much more data.
- Weighting opponents by strength or by meta. "Everyone" means all tested combos, equally.
- Changing how battles are logged or stored.

## Anti-goals (this fails if…)

- A combo with 2–3 lucky battles jumps to #1. Ratings must start from 0 and need data to move.
- Untested matchups are shown as if they were known.
- Ranking becomes too slow on the iPad. Today it runs in a worker in a few seconds, and should
  stay in that range with ~50–100 combos.
- Existing data or backups break. The `field` store and its flags stay readable and importable.

## Approaches considered

- **A. Ratings only.** Best deck is the legal triple with the highest summed rating. Simple and
  fast, but ignores counters, finish risk (burst/KO), first-to-5 vs first-to-7, and lead advice.
- **B. Ratings fill the gaps, simulation decides (chosen by the user).** Real pairing results are
  used, shrunk toward the rating prediction when there are few battles. Untested pairings are
  synthesised from the ratings. The existing 3on3 match simulator ranks decks.
- **C. B plus counter adjustments by type.** Rejected: not enough data to support it.

## Design

### 1. EV rating (new pure module `src/ratings.js`)

- Model: the expected battle score of A vs B (from A's side, −3..+3) is `r[A] − r[B]`.
- Fit all battles at once, by ridge least squares:
  minimise `Σ_battles (score − (r[a] − r[b]))² + λ Σ_combos r²`.
  Draws score 0 and count as data. `λ` acts as pseudo-battles at EV 0 per combo; start at
  `λ = 3` (named constant, tunable). The fit doesn't depend on battle order.
- Who is rated: every combo with ≥1 battle, owned or not. Mirror battles (same id both sides)
  are ignored.
- Uncertainty: residual variance `σ²` (from the fit, floored at 1.0 so tiny samples can't look
  certain) × diagonal of `(XᵀX + λI)⁻¹` gives each rating's SE. Show `r ± 1.96·SE`.
- Size is at most ~a few hundred combos, so a direct dense solve (Cholesky or Gauss–Jordan) is
  fine. Disconnected groups stay well-defined because of the ridge.
- Output: `ratings(state) → Map<comboId, { r, se, n, opponents }>`, where `n` is the battle count
  and `opponents` the number of distinct opponents faced.

Worked example (the user's "beat a really good combo, jump high" case): Y is rated +1.5 from
many battles. New combo X plays 10 battles vs Y and averages +2. X's estimate is about
`10 × (2 + 1.5) / (10 + λ) ≈ 2.7` with λ = 3, so it jumps straight to the top. Its range is
wide, because all its evidence comes from one opponent, so Next prioritises testing it
(Contender, highest upper bound first). After 1–2 battles it moves only part of the way.

Ratings are relative: adding many weak variants lowers the pool average but doesn't change the
order at the top.

### 2. Pairing distributions (extend `src/matchups.js`)

The simulator needs a 7-outcome distribution per pairing (`{counts, n}` as today).

- **Predicted shape for A vs B**: start from A's pooled outcome counts (A's side) averaged with
  B's pooled counts negated, so both combos' finish habits show (e.g. burst-prone). Then
  exponentially tilt that distribution so its mean equals `r[A] − r[B]` (clamped to ±2.5). Solve
  the tilt by bisection. If a combo has no decisive pooled results, fall back to the symmetric
  spin-only shape used for mirrors today.
- **Tested pairing**: `counts = observed + K × predicted` with `K = 2` pseudo-battles (tunable).
  With many battles the real data dominates, and with 1–2 battles the result is pulled toward
  the rating.
- **Untested pairing**: `counts = K_untested × predicted` with `K_untested = 2`. Because there are
  so few pseudo-battles, `matchWinPosterior` gives it a wide posterior, so uncertainty carries
  through to the deck's interval automatically.
- Each matrix cell also carries `estimated: true|false` for display.

### 3. Lineup ranking (rework `rankLineups` in `src/lineup.js`)

- **Candidates**: combos whose parts are all owned and that have ≥1 battle (unchanged rule).
- **Opponents ("everyone")**: all combos with ≥1 battle, owned or not. The `field` store is no
  longer used for ranking.
- **Opponent decks (builder-check call)**: a covering sample. Shuffle all opponents into
  disjoint triples so each appears at least once, then top up with further shuffled triples to a
  minimum of 20. Every candidate deck faces the **same** triples. When a candidate's own combo
  appears as an opponent, that cell uses the existing mirror distribution. The shuffle seed is
  fixed (not the data hash), so logging one battle doesn't redraw the whole sample. Legality of
  opponent triples doesn't matter (yardstick, as today).
- **No retiring (user decision)**: every tested combo stays an opponent. Weak combos lift every
  deck's P(win) a little and may slightly favour decks that crush weak opponents. This is
  accepted, to be revisited if it visibly distorts the ranking.
- **Pre-filter before simulation** (needed now that every legal deck is rankable): score each
  legal deck by the sum of member ratings and take the top `PREFILTER = 60` decks. Then run the
  existing screen (1000 matches × 3 leads, first-to-5) → top `TOP_N = 5` refined, with lead and
  first-to-7 exactly as today.
- **Ranking score (user decision)**: decks are ranked by their best estimate (mean P(win)),
  not their worst case. A promising, partly tested deck can be #1 straight away, with the
  estimated-share warning.
- **Estimated share**: for each ranked deck, report `estimatedShare` = the fraction of
  (member, opponent) pairings in the sample that are untested.
- `blocked` / "Closest decks" goes away, since every legal deck is rankable. `fieldLegal` and the
  field-legality banner go away. `fieldTooSmall` becomes "fewer than 3 tested combos".

### 4. Lineup tab UI (`src/ui/lineup.js`)

- Header text: "Best decks against all tested combos."
- Each deck card adds a line such as "Based on 72% tested matchups", with a flag style when the
  estimated share is over 50%.
- Remove the "Add to field" buttons (no field).
- **Combo leaderboard always shows**, below the decks: rating with range, battles, opponents
  faced, sorted by rating. Untested owned combos are listed at the bottom as "not yet tested".

### 5. Next tab (`src/suggest.js`, `src/ui/next.js`)

Replace the stage-ordered kinds with these, in priority order, capped at 8 (`MAX_SUGGESTIONS`):

1. **Screen**: owned combos with 0 battles. **One** suggestion per combo, against the
   highest-rated tested opponent it shares no parts with (falling back to a clashing one, with
   the clash note as today). At most 3 Screen suggestions at a time. Newest combo first, using a
   new optional `createdAt` on combos (set on create; missing = oldest; import accepts it when
   present or absent).
2. **Contender**: owned tested combos not in the #1 deck whose rating range overlaps the lowest
   rating among the #1 deck's members (upper bound ≥ that rating). Suggest each against the
   highest-rated opponent it hasn't faced (or, if it has faced all, its least-tested one).
   Order by upper bound, highest first.
3. **Top-deck check**: for each #1 deck member, the untested or under-tested (<5 battles) pairing
   against the highest-rated opponents. Order by opponent rating.
4. **Fix**: burst-risk / KO-risk part swaps (reference deck = #1 deck), now only for #1 deck
   members and contenders. Field-clash
   fixes and the "Use in field instead of…" button are removed.
5. **Narrow**: #1 deck pairings with wide EV intervals, unchanged.

**Low-ranked combos fall off (user decision)**: once a tested combo's rating upper bound is
below the lowest-rated #1 deck member, it gets no suggestions of its own. It only gets battles
again as an opponent, or if new results lift its range back into contention. Top-deck checks
prefer high-rated opponents, so weak combos are rarely suggested as opponents either; their
matchups come from the ratings.

Baseline and Blocking kinds are removed. Each suggestion stays "about 10 battles", and Start
works as today.

### 6. Combos tab (`src/ui/combos.js`)

- Cards are ordered by rating. Each card shows the combo's rating ± range.
- A card's opponent table lists **every combo it has faced** (not the field). The "Overall"
  row becomes "Overall vs everyone faced".
- "In field" and "Core" switches are removed from the UI. Clash chips compare against the top
  leaderboard combos only.

### 7. Data and compatibility

- No schema change except the optional `combos.createdAt`. The `field` store stays and continues to import/export, so old backups and
  older app versions still work. It's just no longer read for ranking or suggestions.
- `lineupKey` no longer needs the field. It drops it so field edits don't trigger recomputes.
- Bump the service worker `CACHE_VERSION` and add `src/ratings.js` to the `CORE` list.

## Testing

- `ratings`: symmetric data gives r = 0. A combo that beats a strong combo rates above one that
  beats a weak combo by the same score. Ridge keeps a 1-battle combo near 0. Results don't depend
  on battle order. SE shrinks with more battles.
- Distributions: the tilt hits the target mean. With many battles, observed counts dominate.
  Untested cells are flagged `estimated`.
- Lineup: a partly tested strong combo can appear in the #1 deck. The pre-filter keeps the rating
  top. `estimatedShare` is correct. The result is deterministic for a seed.
- Suggest: untested owned combos produce Screen suggestions. Contender ordering. No
  Baseline/Blocking kinds.
- Performance: a synthetic 80-combo, 600-battle state ranks in under ~5 s in Node.

## Left to the builder

- Exact constants (`λ`, `K`, `PREFILTER`, sample sizes) within the spirit above, tuned so tests
  and the performance target pass.
- Solver choice, and how suggestions tie-break.
- Copy wording, as long as it's plain and says when results rest on estimates.
