# Sip 🎀

A tiny hydration companion app. Log what you drink, watch the bottle fill, and
Mochi the cat reacts — she perks up when you drink, droops when you forget, and
throws confetti when you hit your daily goal. Streaks unlock bows, hats and
scenes to dress her in.

Vanilla HTML/CSS/JS. No frameworks, no build step, no tracking, no server —
everything is stored locally on the device.

## Install on a phone (Android app)

This is the version that reminds you while the app is closed.

1. On the phone, open **https://github.com/apoms007/Sip/releases/latest**
2. Tap **sip.apk** to download it, then tap the downloaded file.
3. Android will ask to allow installs from this source — allow it, then **Install**.
4. Open Sip and tap **Enable reminders** once.
5. If it offers to keep reminders working, say yes — that stops the phone from
   putting the app to sleep and silently dropping reminders.

To update later, download the same link again and install over the top. History
and streaks are kept, as long as it is an update rather than a fresh install
after uninstalling.

### Reminders and battery

Reminders are handed to Android's own alarm scheduler, so nothing runs in the
background between them — roughly nine short wake-ups across the day, then the
app is idle. It survives a reboot, and goes quiet once the daily goal is met.

### Or use it in the browser

No install needed, but reminders only work while the tab is open:
open https://apoms007.github.io/Sip/ and choose **Add to Home screen**.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup and screens |
| `style.css` | Theme, layout, animations |
| `app.js` | State, mascot SVG, wardrobe, reminders |
| `sw.js` | Offline cache + background reminder check |
| `icons/build_icons.py` | Regenerates the app icons (needs Pillow) |

Mochi is an original character drawn procedurally in SVG; no third-party artwork
is used.
