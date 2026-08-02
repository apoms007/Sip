# Sip 🎀

A tiny hydration companion app. Log what you drink, watch the bottle fill, and
Mochi the cat reacts — she perks up when you drink, droops when you forget, and
throws confetti when you hit your daily goal. Streaks unlock bows, hats and
scenes to dress her in.

Vanilla HTML/CSS/JS. No frameworks, no build step, no tracking, no server —
everything is stored locally on the device.

## Install on a phone

1. Open the site in Chrome.
2. Menu → **Add to Home screen**.
3. Open it from the icon, then tap **Enable reminders** once.

Installing to the home screen is what allows reminders to fire while the app is
closed.

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
