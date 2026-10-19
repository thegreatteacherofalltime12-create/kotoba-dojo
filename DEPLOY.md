# Kotoba Dojo — deploy this package

Import the zip, then deploy. Two commands.

```powershell
npm run import -- "D:\Appbuilder\omni-blackjack.zip"
npx.cmd wrangler deploy
```

> **Do not** use `Expand-Archive -Force` into the project folder — it silently
> restores old copies of every file not in the zip, which has caused problems before.

Confirm it landed:

```powershell
$r = Invoke-RestMethod https://kotoba-dojo.prior-mixed-theme.workers.dev/version.json
$r.build
```

That should match the `build` line under the tagline on the home screen.

## What's in it

Only changed files — nothing else in your project is touched.

**public/** — app.js, casino.js, game-modes.js, battle.js, mines.js,
index.html, styles.css, sw.js, version.json

**src/** — casino-floor.js, casino-games.js, casino-tables.js,
lobby.js, battle-lobby.js, mine-lobby.js, firestore.js, index.js

## One thing this package can't do

The installed app's name on a home screen comes from `manifest.webmanifest`,
which isn't in this package. Update it in place — this only touches the two
name fields and leaves icons, colours and start_url alone:

```powershell
$m = Get-Content public\manifest.webmanifest -Raw | ConvertFrom-Json
$m.name = "Omni Multiverse of Madness"
$m.short_name = "Omni"
$m | ConvertTo-Json -Depth 10 | Set-Content public\manifest.webmanifest -NoNewline
```

Anyone who already installed it keeps the old label until they reinstall.

## Notes

- No service worker cache bump needed. JS and CSS are fetched network-first,
  so a relaunch is enough.
- The build stamp moved, so anyone with the app open gets a Reload prompt.
- Past Games only records rounds played after this deploy.
