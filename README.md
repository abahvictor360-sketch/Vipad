# Vipad — Audio Recorder & Editor

Vipad is a fast, private audio recorder and editor that runs on **Windows, macOS, Linux, Android, iOS and the web** from one codebase.

- **Landing page:** `index.html` → download buttons for every platform
- **Editor:** `app.html` (installable PWA, works offline)
- **Downloads:** `download.html` — every platform, live version/size from the latest GitHub Release
- **Guide:** `guide.html` — step-by-step with screenshots (regenerate with `npm run guide:shots` while `vite preview` runs)

## Features

| Area | What you get |
| --- | --- |
| Record | Lossless 32-bit float capture (AudioWorklet), device picker, mono/stereo, pause/resume, record into new file / insert / overdub, live level meter, auto-save to library |
| Multitrack (toggle on/off) | Unlimited tracks, per-track volume / pan / mute / solo, drag clips in time and between tracks, split, duplicate, clip gain, record new tracks while hearing the others, mixdown to a file, `.vipad` project files |
| Menu & settings | WavePad-style ☰ menu (File, Edit, Levels, Effects, Restore, Control, Generate, Bookmark, Region, View, Tools, Window, Help), Open Recent, Save As / Save All / Close All, persisted Settings (defaults for new files, recording, export, undo levels, follow playhead…) |
| Edit | Sample-accurate selection, cut / copy / paste / mix-paste / delete / trim / silence / insert silence, unlimited undo/redo, markers, multiple files in tabs |
| View | Zoom from whole-file to individual samples, pinch-zoom on touch, overview navigator, follow-playhead, stereo level meters, real-time spectrum |
| Effects (34) | Grab Noise Sample + Apply Subtraction from Noise Sample, Multi-band noise gate, Click/Pop removal (auto & manual), Amplify, Normalize, Fade in/out, Volume ramp, 10-band EQ, Low/High/Band-pass, Bass, Treble, Compressor, Limiter, Noise gate, Noise reduction (spectral), Hum notch, De-click, DC offset, Auto-trim silence, Speed, Tempo (WSOLA, keeps pitch), Pitch (keeps length), Reverse, Echo, Reverb, Chorus, Tremolo, Distortion, Telephone, Invert, Pan, Swap channels, Vocal remover, Stereo width |
| Generate | Tones (sine/square/saw/triangle), white/pink/brown noise, silence, DTMF |
| Files | Open WAV (incl. µ-law/A-law), AIFF/AIFF-C, AU, MP3, OGG, FLAC, M4A/AAC, WebM, Opus. Save as MP3, M4A (AAC, where the OS provides an encoder), OGG Opus, WebM Opus, WAV (8/16/24/32f, µ-law, A-law), FLAC (16/24-bit, in-house lossless encoder), AIFF, AU, RAW PCM — with title/artist/album/year/genre/comment tags (ID3, Vorbis comments, RIFF INFO, AIFF text). Export WAV 8/16/24/32f and MP3 64–320 kbps, as mono or stereo, at any sample rate from 10 kHz to 225 kHz (windowed-sinc anti-alias resampling; MP3 up to 48 kHz). Batch processor. |
| Never lose work | Every open file, the multitrack session and recordings *while they record* (2-second chunks) are autosaved to IndexedDB with persistent storage; reopening after a crash/close restores everything, interrupted takes are rebuilt, closed files stay restorable for 30 days |
| Updates & shortcuts | Installed apps check GitHub Releases at start-up and every 6 h and show an in-app banner + system notification; the web app offers “Update now” when its service worker has a new version. Desktop/Start-menu shortcuts (installer + in-app), Windows jump list, macOS dock menu, Linux launcher actions, PWA icon quick actions |
| Pro tools | Spectrogram view, vertical (amplitude) zoom with dB ruler, frequency analysis (Welch spectrum, pitch/note), BS.1770 loudness (integrated LUFS, LRA, true peak) and Loudness Normalize, split at cursor/markers/silence, join, extract channel, insert file, effect presets, undo history panel, snap to zero crossings, record countdown, sound-activated recording, De-clipper, De-esser, Remove Silence, Flanger, Phaser |
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

CI (`.github/workflows/build.yml`) builds every platform on each push, and every push to the default branch publishes a GitHub Release for the version in `package.json` if it does not exist yet — published releases are never modified, so bump the version to ship new installers. The download page always points to the latest release. iOS ships as an unsigned `.ipa` for AltStore/Sideloadly plus the PWA.

### Signing (optional, recommended for public release)

- **Android:** add repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is signed with a debug key (installable, not Play-Store-ready).
- **Windows / macOS:** add electron-builder's `CSC_LINK` / `CSC_KEY_PASSWORD` (and Apple notarization credentials) to remove “unknown developer” warnings.
- **iOS:** requires an Apple Developer account; open `ios/App` in Xcode to archive. Until then iPhone/iPad users install the PWA (Safari → Share → Add to Home Screen).

## Deploying the website

The repo is Vercel-ready (`vercel.json`): framework Vite, output `dist/`. `/` is the landing page and `/app` is the editor.
