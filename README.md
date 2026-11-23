# Vipad — Audio Recorder & Editor

Vipad is a fast, private audio recorder and editor that runs on **Windows, macOS, Linux, Android, iOS and the web** from one codebase.

- **Landing page:** `index.html` → download buttons for every platform
- **Editor:** `app.html` (installable PWA, works offline)

## Features

| Area | What you get |
| --- | --- |
| Record | Lossless 32-bit float capture (AudioWorklet), device picker, mono/stereo, pause/resume, record into new file / insert / overdub, live level meter, auto-save to library |
| Edit | Sample-accurate selection, cut / copy / paste / mix-paste / delete / trim / silence / insert silence, unlimited undo/redo, markers, multiple files in tabs |
| View | Zoom from whole-file to individual samples, pinch-zoom on touch, overview navigator, follow-playhead, stereo level meters, real-time spectrum |
| Effects (31) | Amplify, Normalize, Fade in/out, Volume ramp, 10-band EQ, Low/High/Band-pass, Bass, Treble, Compressor, Limiter, Noise gate, Noise reduction (spectral), Hum notch, De-click, DC offset, Auto-trim silence, Speed, Tempo (WSOLA, keeps pitch), Pitch (keeps length), Reverse, Echo, Reverb, Chorus, Tremolo, Distortion, Telephone, Invert, Pan, Swap channels, Vocal remover, Stereo width |
| Generate | Tones (sine/square/saw/triangle), white/pink/brown noise, silence, DTMF |
| Files | Open WAV (native 8/16/24/32-bit & float), MP3, OGG, FLAC, M4A/AAC, WebM, Opus. Export WAV 8/16/24/32f and MP3 64–320 kbps with resampling & channel conversion. Batch processor. |
| Platform | Effects run in a Web Worker, PWA offline cache + OS “Open with…”, Electron desktop app (mic-only permissions, external links sandboxed), Capacitor Android/iOS with native share/save |

All DSP lives in `src/audio/` as pure, framework-free TypeScript and is unit tested.

## Development

```bash
npm ci
npm run dev           # http://localhost:5173 (landing) and /app.html (editor)
npm run test          # unit tests (Vitest)
npm run build         # production web build → dist/
npm run test:e2e      # Playwright end-to-end (desktop, tablet, phone) against the build
```

## Building the apps

| Platform | Command | Output |
| --- | --- | --- |
| Windows | `npm run dist:win` | `release/Vipad-Setup-x64.exe` |
| macOS | `npm run dist:mac` | `release/Vipad-mac-universal.dmg` |
| Linux | `npm run dist:linux` | `release/Vipad-linux-x86_64.AppImage`, `release/Vipad-linux-amd64.deb` |
| Android | `npm run cap:sync && cd android && ./gradlew assembleRelease` | `android/app/build/outputs/apk/release/app-release.apk` |
| iOS | `npm run cap:sync && npx cap open ios` (Xcode) | App Store / TestFlight build |

CI (`.github/workflows/build.yml`) builds every platform on each push. **Push a tag like `v1.0.0` to publish a GitHub Release** — the landing page's download buttons always point to the latest release.

### Signing (optional, recommended for public release)

- **Android:** add repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is signed with a debug key (installable, not Play-Store-ready).
- **Windows / macOS:** add electron-builder's `CSC_LINK` / `CSC_KEY_PASSWORD` (and Apple notarization credentials) to remove “unknown developer” warnings.
- **iOS:** requires an Apple Developer account; open `ios/App` in Xcode to archive. Until then iPhone/iPad users install the PWA (Safari → Share → Add to Home Screen).

## Deploying the website

The repo is Vercel-ready (`vercel.json`): framework Vite, output `dist/`. `/` is the landing page and `/app` is the editor.
