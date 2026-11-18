# Bey Lab

Bey Lab is a small app for testing Beyblade X decks. You log battles, and it keeps
track of which combos win, suggests which matchups to test next, and helps build a
three-Bey lineup. It runs on the iPad like a normal app, works without Wi-Fi, and keeps
everything on the iPad itself (no account, nothing is sent anywhere).

Address (once published): https://smithan7.github.io/bey-lab/

## How the best deck is picked

- Every combo you've logged a battle with gets a **rating**: how many points it's expected to
  score per battle against the average tested combo. Beating a strong combo raises it more than
  beating a weak one, and a combo needs several battles before its rating moves far from 0.
- **Lineup** ranks legal decks (no shared parts) by their chance of winning a match against all
  tested combos. Matchups you haven't tested yet are estimated from the ratings, and each deck
  says how much of it rests on tested matchups.
- **Next** suggests what to test: new combos first, then **unlocks** (when two top combos need the
  same ratchet or bit, a version of one with another part you own), then the matchups with the highest chance of
  changing your best deck after 10 more battles, then part-swap fixes. It never pairs two combos
  that share a part, unless you've marked that part **Have multiple** (Parts tab → ⓘ).

## Part reference and ideas

- **Parts** shows each part's packaging stats as bars (from the Beyblade wiki) and how it does at
  WBO events: tier, 1st-place rate and top-3 finishes (from beywatch.gg, all-time, worldwide).
  Tiles show the tier; **Sort by WBO tier** puts the best first.
- **Next** adds **Idea** cards: untried combos from parts you own that WBO results and packaging
  stats favour. On **Combos → Edit → Suggest 3 variants** you get three versions of any combo.
  On **Parts → Parts to look for** you get the parts you don't own that would most improve your top
  combos (a better ratchet or bit for one of them, or a blade that beats your best combo of its type),
  with what each would let you build. "I got it" marks the part owned.
- The reference is a snapshot in `app/data/reference.json`. Refresh it with
  `node scripts/update-reference.mjs` (or ask Claude to "refresh the meta").

## Install on the iPad

1. Open the address above in **Safari** (it has to be Safari).
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open Bey Lab from the Home Screen once while online.
4. Still online, open the **Parts** tab and browse your owned parts once. Part photos you've
   viewed while online are saved for offline use; ones you haven't viewed won't show offline.

After that it works with no internet.

## Back up your data

Your battles live only on this iPad, so back them up. About once a week:

1. Tap the **⚙** gear icon at the top right, then **Export data** (or **Export with photos**
   to include your own photos).
2. In the share sheet, choose **Save to Files**, then pick **iCloud Drive** and tap **Save**.

## Restore from a backup

If the app is reinstalled or you move to a new iPad: install it as above, tap the **⚙**
gear icon at the top right, tap **Import data…**, and pick the saved backup file.

## Updating

The app updates itself. The next time you open it while online, it fetches the newest
version. It can take a second open to see the change: the first open downloads it, the
next one shows it.

## For grown-up developers only

Run the tests (needs Node 22 or later):

    npm test

Serve the app locally:

    python3 -m http.server -d app

Then open http://localhost:8000/. Pushing to `main` runs the tests and publishes `app/`
to GitHub Pages through `.github/workflows/pages.yml`.
