# Lucien Home

A desktop launcher for two Google Apps Script web apps, **Family Planner** and **Family Budget Log**.
Both apps' screens run inside the launcher; everything you type is saved to your own Google Sheet,
so the phone versions stay in sync.

- **Home**: what's coming up, bills due, spending and progress at a glance
- **Planner**: lists, dates, meals, recipes and the shopping list
- **Budget**: spending, bills and due dates, debt, budgets and goals
- **Coming up**: a week board of dates and bills from both apps
- **Notifications**: reminders the day before and the day of

## Install

Download the newest **Lucien Home Setup x.y.z.exe** from [Releases](../../releases) and run it.
Windows may say "Windows protected your PC" the first time (the installer isn't paid-signed): click **More info → Run anyway**.
After that, Lucien Home updates itself: a green **Update** button appears when a new version is ready.

The installer contains no one's data or links. On first open, go to **Settings → Apps** and paste your two app links.

## Set up your own apps

The launcher needs your own copy of each app (they're free Google Apps Script projects):

1. Create a Google Sheet. Open **Extensions → Apps Script**.
2. Copy in `apps/planner/Code.gs` and `apps/planner/Index.html` (or the `budget` ones, in a second Sheet).
3. Edit the settings at the top of Code.gs: your names, and for the Budget Log a PIN and your Sheet's ID.
4. **Deploy → New deployment → Web app**, *Execute as: Me*, *Who has access: Anyone*. Copy the link ending in `/exec`.
5. Paste that link into Lucien Home → Settings → Apps. For the Budget Log, sign in once with the PIN.

Nothing personal ever goes into this repository: links and sign-ins stay on each PC, encrypted with the Windows account.

## Layout

- `launcher/app`: the Electron app (`main.js`, `renderer/` for the launcher screens, `apps/` for the bundled app screens)
- `launcher/build`: the Windows installer script (NSIS) and helpers
- `apps/`: the two Apps Script projects
