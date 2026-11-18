# Part reference: packaging stats, WBO results, ideas and variants

Date: 2026-11-18. Status: approved.

## Why
A reference for the family (what's good, what might be good) and for the app's suggestions:
new combos and variants to test, built from owned parts.

## Design (as approved)
- Snapshot `app/data/reference.json`, built by `scripts/update-reference.mjs` on request:
  packaging stats per part from the Beyblade fandom wiki (Attack, Defense, Stamina, Dash, Burst,
  height), and per-part tier / 1st rate / top-3 finishes plus top combos from beywatch.gg. Works
  offline; credited wherever shown.
- Parts tab: tier badge on tiles, packaging-style segmented stat bars and an "At WBO events"
  section in the detail sheet, and "Sort by WBO tier".
- Next: up to 2 **Idea** cards after Unlock: the best untried owned combo per blade, scored by
  tournament results (60%) and how well packaging stats suit the blade's type (40%), plus a bonus
  for an exact beywatch top combo.
- Combos → Edit → **Suggest 3 variants**: top 3 untried same-blade variants by the same score,
  at least one a single-part swap; "Try it" saves it and opens the Log against the strongest combo
  it can be built alongside.

## Builder calls
- beywatch's time filters work only in the browser, so the snapshot uses its default all-time,
  worldwide view (the approved design said last 12 months).
- Own-data part effects by type are left for later, once there are more battles.
