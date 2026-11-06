# Bey Lab — Design

*2026-11-06. An iPad web app for choosing the best 3-bey Beyblade X tournament deck from head-to-head test data, using a risk-weighted (EV) approach.*

## 1. Intent

The user and their son test Beyblade X combos against each other in batches of 10 battles. They want to know which three combos give the best chance of winning a tournament match, not just which combo wins most often.

The core idea is risk-weighted scoring. A combo that wins most battles by Spin finish (1 point) but sometimes gives up Xtreme finishes (3 points) may be worse than its win rate suggests. A combo that rarely wins but scores Xtremes when it does may be better. The per-battle metric is:

> **EV = P(win) · E[points | win] − P(lose) · E[points | loss]**

Each EV comes with an honest measure of how confident we can be. Ten battles is a small sample, and the app must never present a noisy number as settled.

The method is a **baseline gauntlet**. A baseline deck of 3 "good" combos stands in for the tournament field. Each new candidate combo is tested against each baseline bey. From the results, the app works out the best **legal** 3-bey deck and suggests what to test next.

The son runs it on his **iPad**, at the practice stadium, between launches.

## 2. Domain rules (from the user)

**Scoring, per battle, to the winner:**
- Spin finish: 1 point
- Burst finish (B): 2 points
- Pocket / over finish (P): 2 points
- Xtreme finish: 3 points

**Tournament format:**
- 3on3 decks: each player brings 3 combos.
- Matches are first to 5 points. From the semi-finals on, they're first to 7.
- Each player picks a launch order for slots 1, 2, 3. Battle *i* of a set is our slot *i* vs their slot *i*.
- Set 1 orders are blind: you don't know the opponent's order.
- After each set of 3, both players may re-order.
- Sets repeat until someone reaches the target. Points can overshoot the target.

**Deck legality:**
- No part may appear twice in a deck: no repeated blade, ratchet or bit.
- Some blades have a **built-in ratchet** (for example Rocket Griffon). They have no separate ratchet, so they can never clash on ratchet.

**Combo identity:** blade + ratchet (or "built-in") + bit.

**Naming:** always use full names, such as "Pegasus Blast 2-60 Free Ball", never "Blast".

## 3. Goals

1. **Fast battle logging on an iPad.** Pick the two combos, then record each battle with one tap: finish type and which side won. Include Draw and Undo.
2. **Matchup statistics** for every pairing tested:
   - record (W-D-L)
   - P(win) and P(lose), with 95% intervals
   - E[points | win] and E[points | loss]
   - EV with a 95% interval
   - P(EV < 0)
   - simulated chance of winning a race to 5 and a race to 7 for that pairing alone
   - finish-type breakdown: how it wins, how it loses
3. **Combo report card:** each combo against every baseline bey, plus an overall row. Flags:
   - high burst rate taken
   - high Pocket/Xtreme rate taken (self-KO risk)
   - parts clashes with other strong combos
   - "not enough data"
4. **Best lineup:** the best legal 3-combo deck, ranked by simulated **P(match win)** against the opponent field, shown separately for first-to-5 and first-to-7 with uncertainty. It also suggests a lead bey (slot 1) and flags when the first-to-5 and first-to-7 answers differ.
5. **Test suggestions:** a short ranked list of what to test next, each with a one-line reason.
6. **Parts inventory:** mark which blades, ratchets and bits are owned, including built-in-ratchet blades. Suggestions only use owned parts.
7. **Opponent field is editable.** It starts as the baseline deck. Local meta combos can be added later (the user expects to learn the meta around December 2026).
8. **Works offline** once installed, and is added to the iPad home screen.
9. **Backup:** Export and Import the full dataset as a file, so it can be saved to iCloud Drive or Files.
10. **Preloaded with the existing test data** (Appendix A).

## 4. Non-goals (v1)

- Syncing between devices or accounts. The iPad is the only logging device.
- An App Store app, a native app, or a desktop executable.
- Multiple users or profiles.
- Game-theory counter-picking between sets based on the opponent's previous order. v1 treats every set as a blind re-order. This can come later.
- Automatic scraping of meta or tournament data.

## 5. Anti-goals: failure even if it technically works

- **Too fiddly to log between launches.** A kid with a launcher in one hand has to be able to use it. Big touch targets and one tap per battle.
- **False confidence.** Never show an EV or lineup ranking without its uncertainty. Pairings with no data must read as "unknown", never as even.
- **Recommending an illegal deck,** or a deck built from parts they don't own.
- **Losing the data.** Every battle must persist immediately. Undo must be possible, and backup must be easy.
- **Shortened bey names** in the UI.

## 6. Decisions made

**By the user:**
- It's a web app on the son's iPad, run from the home screen.
- iPad only for now, no sync.
- Layout is roughly the mockups shown:
  - Tabs: **Log · Combos · Lineup · Next**
  - Phone/tablet-first logging with big buttons
  - Dashboard-style combo cards and lineup view
- The baseline deck is:
  - Wizard Rod 2-60 Gear Ball
  - Cobalt Drake 1-60 Free Flat
  - Pegasus Blast 2-60 Free Ball
- Test batches are 10 battles. The app shouldn't force batch boundaries, but it may show batch progress.
- Finish types tracked: Spin, Burst, Pocket, Xtreme, Draw.

**By Claude (the user can override):**
- **Hosting:** a free static host. GitHub Pages if the user has an account, otherwise Netlify drag-and-drop. Installed via Safari → Share → Add to Home Screen.
- **Offline:** a web app manifest plus a service worker that caches the app shell.
- **Storage:** on-device (IndexedDB or localStorage, builder's call). Every write persists immediately.
- **Statistics:**
  - Wilson interval for P(win) and P(lose).
  - Bootstrap or t interval for EV.
  - **Bayesian P(EV<0)**: a Dirichlet posterior over the seven outcomes {−3, −2, −1, 0, +1, +2, +3}, with a light prior of 1/7 pseudo-count per outcome. This method is what's already been reported to the user, so keep it for consistency.
- **Orientation:** each pairing is stored once. Results are negated when viewed from the other side.
- **Mirror match:** a combo against itself is EV 0 by symmetry. A pairing that only shares the blade is *not* a mirror.
- **Draws** score 0 points to both players in the simulator. The raw finishes are still stored. The user logged one draw as `0[+2B, −2P]`, meaning Red Hulk burst Wizard Rod while Red Hulk was pocketed.
- **Untyped results**, such as a "2" with no B or P, are stored as type unknown. They still score correctly.
- **Match simulator:**
  - Monte Carlo. Each simulated match first draws one outcome distribution per pairing from that pairing's Dirichlet posterior, then plays the match. This carries data uncertainty into P(match win), so the app can show an interval rather than just a point.
  - The opponent's order is uniformly random each set.
  - Our order is either random each set or has a fixed lead, so the app can recommend a lead.
  - Thousands of matches per deck is fine. It must stay responsive on an iPad.
- **Lineup ranking:**
  - Enumerate every legal 3-combo deck from owned, tested combos.
  - Score each against the opponent field deck by P(match win), first-to-5 and first-to-7.
  - A deck is only ranked if every pairing it needs has data, or is a mirror. Otherwise it's listed as "needs testing: X vs Y".
  - If the opponent field has more than 3 combos, score against each possible field deck of 3 and average.
- **Test suggestions** are heuristic, ranked by:
  1. Missing pairings that block a promising deck from being ranked.
  2. Pairings in the top decks with the widest EV intervals.
  3. Part-swap fixes for flagged problems, using owned parts. For example, a combo burst a lot, so try it with a different bit.
  4. Pairings that would decide a close race for a lineup spot.

### Settled after builder review (Claude's calls)

- **Baseline combos have two roles.** They are the user's main deck, so they are deck candidates and also the stand-in opponent field. To rank any deck that includes them, the app needs baseline-vs-baseline results:
  - Wizard Rod vs Cobalt Drake
  - Wizard Rod vs Pegasus Blast
  - Cobalt Drake vs Pegasus Blast

  These three pairings are the **first items on the Next tab** at launch.

  Until enough pairings exist, the Lineup tab shows an empty state:
  - the closest-to-rankable decks
  - exactly which pairings each one still needs
  - a per-combo "average EV vs field" leaderboard, so the tab is useful from day one
- **The opponent field doesn't need to be legal.** It's a yardstick, so the app simulates against it as-is and shows a warning badge. If the field has more than 3 combos, average over *all* 3-combo subsets, legal or not.
- **Parts library (user decision).**
  - The app ships with a **built-in Beyblade X parts catalog**: blades, ratchets and bits, loaded from `docs/parts-catalog.json`. That file was researched from public sources as of 2026-11-06.
  - Each part carries its official full name, alternate names (Takara Tomy vs Hasbro), line, type and confidence. Blades also carry a built-in-ratchet flag and multi-piece components where they apply.
  - Users can **add new blades, ratchets and bits** in the app, and edit or rename parts they added. User-added parts are stored with the user's data and survive Export/Import.
  - When a catalog update ships with a later app version, it adds new parts without overwriting user-added ones.
  - Combo pickers search the catalog plus user parts, and match on alternate names.
  - The inventory screen marks which parts are **owned**. Part-swap suggestions only draw from owned parts.
- **Combo structure follows the catalog research.** A combo is not always blade + ratchet + bit:
  - **Standard (BX/UX):** blade + ratchet + bit.
  - **Built-in-ratchet blades:** blade + bit. Examples: Bullet Griffon (Hasbro: Rocket Griffon), Glory Valkyrie, Hells Nether, Cutter Shinobi, Rampart Aegis, Seize Jaguar, Valor Bison.
  - **Ratchet-bit pieces:** blade + one fused ratchet-bit. Examples: Turbo, Operate.
  - **CX blades:** lock chip + main blade + assist blade, then ratchet + bit.
  - **CX Expand blades:** lock chip + over blade + metal blade + assist blade, then ratchet + bit.

  The **no repeated parts** rule applies to every physical component, including lock chips and assist blades. The catalog's `cx_parts` section lists those components.
- **Display names.** Every part shows the name the user prefers. Alternate names (Takara Tomy vs Hasbro) are searchable and shown as a subtitle. The user mixes the two: Wizard Rod is the Takara Tomy name, while Rocket Griffon and Red Hulk are Hasbro names. The preload uses exactly the names in Appendix A as the preferred names.
- **"Pop Out"** isn't an official part name. The user confirmed it is **not** Turbo, and they also own Turbo; Turbo is pre-ticked as owned. They will identify "Pop Out" themselves in the app's library. So the preload creates it as a user-added bit, "Pop Out (unverified)", which the user can rename or merge into a catalog bit.
- **Parts library with photos (user decision).**
  - **Library screen.** It shows a tile for every catalog part, grouped as Blades, Ratchets, Bits, and CX pieces (lock chip, main blade, over blade, metal blade, assist blade). It has search across all names. Tapping a tile toggles **owned**, and there's an "owned only" filter.
  - **Reference photo.** Each tile starts with the catalog's stock photo (`image_url`, with `image_confidence`).
    - Photos are hotlinked from their source, never bundled into the hosted site, because they are Takara Tomy / Hasbro / Fandom images for personal use.
    - **The Fandom image host returns 404 to requests that send a referrer from another site.** Every `<img>`, and any fetch the service worker makes to cache them, must use `referrerpolicy="no-referrer"` (or `referrer: 'no-referrer'` on fetch).
    - Coverage is 100%. Every part has a link; 78 of the 159 blades are blade-only shots and the rest are combo shots (`medium`).
    - The first time each image is viewed while online, it's saved on the iPad so the library works offline.
    - A part with no image says "no reference photo". Images with low confidence are labeled that way.
  - **Your photos.** A part's detail view has **Add photo** (camera or photo library), and a part can have several photos.
    - Your first photo becomes the tile image for that part, and you can choose a different one.
    - The detail view shows your photos next to the reference photo, to confirm what a piece is.
    - Photos are resized on-device to a sensible size and stored with your data.
    - Export includes the photos, either in the backup file or as an optional "with photos" export, builder's call.
  - **Ratchets** are listed by number, such as 2-60. Photos are optional for them.
- **Starting inventory.** It's set in the app on first launch. A checklist of catalog parts is pre-ticked for every part that appears in Appendix A.
- **The field grows, and the best deck changes (user decision).**
  - **Opponent field.** These are the combos tested against. It starts as the baseline three. Combos are only *added*, never removed, so past results stay usable. A combo can be marked inactive, which excludes it from scoring but keeps its data. Add to the field:
    - local meta combos
    - any combo that enters the best deck, since a good combo is one opponents are likely to run
  - **Best deck.** This is the app's output and is recalculated from all the data.
  - **Two-stage screening on the Next tab:**
    - **Stage 1:** a new candidate plays 10 battles against each **core** field combo. The core starts as the baseline three.
    - **Stage 2:** candidates whose stage-1 results make them plausible deck members get suggested against the rest of the active field. "Plausible" means their EV interval overlaps the current deck members, or they'd make a legal deck that the current best can't.
- **Mirror distribution.** A combo against itself uses a symmetrized distribution. Take that combo's pooled outcome distribution across all its tested pairings, then average it with its own negation. The mean is EV 0, and the spread matches how that combo actually scores.
- **Lead.** "Lead" means our slot-1 combo in **every** set. Slots 2–3 and the opponent's whole order are random each set. Each deck is scored under each of its 3 possible leads. The deck's score is its best lead, and that lead is the recommendation. The all-random-order score is shown alongside for reference.

## 7. Left to the builder

- Framework choice. Plain HTML/JS or a small framework both work, as long as it hosts as a static site.
- Exact visuals, colors and charts. Use the mockups as guidance.
- How the combo and part pickers work, for example searchable lists or recent combos first.
- Simulation counts and performance tuning.
- File format of the export, as long as Import round-trips it exactly.
- Wording of flags and suggestion reasons.

## Appendix A: Existing data (preload)

Scores are from the **left combo's** side. Positive means the left combo won. Letters give the finish type; blank means Spin for ±1 and Xtreme for ±3.

| # | Left | Right | Results (10 battles each) |
|---|---|---|---|
| 1 | Red Hulk 1-60 Low Rush | Wizard Rod 2-60 Gear Ball | −1, +2 (type unknown), −1, **Draw** (Red Hulk +2B / Wizard Rod +2P), −1, −1, −1, −1, −1, +3 |
| 2 | Red Hulk 1-60 Low Rush | Cobalt Drake 1-60 Free Flat | −3, +1, +1, +1, −2P, +1, −3, −1, +1, −2P |
| 3 | Red Hulk 1-60 Low Rush | Pegasus Blast 2-60 Free Ball | +3, +1, +1, −1, Draw (details unknown), −2P, −1, +2B, −1, −1 |
| 4 | Pegasus Blast 2-60 Pop Out | Wizard Rod 2-60 Gear Ball | −1, −1, −2B, −2B, −1, +2B, −1, −2P, −2B, +3 |
| 5 | Pegasus Blast 2-60 Pop Out | Cobalt Drake 1-60 Free Flat | −1, −2B, −3, −2B, +2P, −2P, −3, −1, +1, +1 |
| 6 | Rocket Griffon (built-in) Hexa | Pegasus Blast 2-60 Free Ball | −3, −3, +2B, −1, −3, −1, −1, −2 (type unknown), +1, −3 |

**Reference numbers** (EV from the left side, P(EV<0) Bayesian). The app should reproduce these, within Monte Carlo noise for the Bayesian column.

| # | W-D-L | EV | P(EV<0) |
|---|---|---|---|
| 1 | 2-1-7 | −0.20 | 0.70 |
| 2 | 5-0-5 | −0.60 | 0.86 |
| 3 | 4-1-5 | +0.10 | 0.44 |
| 4 | 2-0-8 | −0.70 | 0.89 |
| 5 | 3-0-7 | −1.00 | 0.96 |
| 6 | 2-0-8 | −1.40 | 0.99 |

**Known legality problem:** the baseline deck itself is illegal, because Wizard Rod and Pegasus Blast both use 2-60. The app should show this, and suggest testing Pegasus Blast or Wizard Rod on a different owned ratchet.
