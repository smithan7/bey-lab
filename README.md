# Bey Lab

Bey Lab is a small app for testing Beyblade X decks. You log battles, and it keeps
track of which combos win, suggests which matchups to test next, and helps build a
three-Bey lineup. It runs on the iPad like a normal app, works without Wi-Fi, and keeps
everything on the iPad itself (no account, nothing is sent anywhere).

Address (once published): https://smithan7.github.io/bey-lab/

## Install on the iPad

1. Open the address above in **Safari** (it has to be Safari).
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open Bey Lab from the Home Screen once while online.
4. Still online, open the **Parts** tab once so the part photos get saved for offline use.

After that it works with no internet.

## Back up your data

Your battles live only on this iPad, so back them up. About once a week:

1. Go to **Settings** and tap **Export data** (or **Export with photos** to include your own photos).
2. Save the file to **Files**, ideally in **iCloud Drive**.

## Restore from a backup

If the app is reinstalled or you move to a new iPad: install it as above, go to
**Settings**, tap **Import data…**, and pick the saved backup file.

## Updating

The app updates itself. The next time you open it while online, it fetches the newest
version. It can take a second open to see the change: the first open downloads it, the
next one shows it.

## For developers

Run the tests (needs Node 22 or later):

    npm test

Serve the app locally:

    python3 -m http.server -d app

Then open http://localhost:8000/. Pushing to `main` runs the tests and publishes `app/`
to GitHub Pages through `.github/workflows/pages.yml`.
