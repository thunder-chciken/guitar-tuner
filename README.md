# Guitar Tuner

A simple, iOS-style guitar tuner that installs on your phone like an app and works offline.

- Listens through the phone's microphone and detects which string you're playing
- Big note + needle, with plain instructions: "Too low · Tighten", "Too high · Loosen", "In tune"
- Checkmarks as each string is tuned
- Manual mode, 6 alternate tunings + chromatic, reference pitch 430–450 Hz
- Tap a string to hear its reference note
- Keeps the screen awake while tuning; automatic light/dark mode

No build step and no dependencies.

## Run locally

```
python -m http.server 5178
```
Open http://localhost:5178 (the mic works on localhost).
Test without a guitar: `?demo=110` feeds the tuner a synthetic tone.

## Put it on your phone

Phones only allow the microphone on **https://** pages, so host this folder on any
static host (Vercel, Netlify Drop, GitHub Pages, Cloudflare Pages). Then on the phone:

- **iPhone (Safari):** open the link → Share → **Add to Home Screen**
- **Android (Chrome):** open the link → ⋮ → **Install app**
