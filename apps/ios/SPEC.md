# drft iOS — Phase 4 Spec

The iOS app is an inbox slot: widget, dictation, keep, gone. Capture-only — no list,
no reading, no replies, no AI surface on the phone. Development happens on the web.

## Hard rules (product contract, non-negotiable)

1. **Capture never fails visibly.** If the network is down, the fragment queues
   on-device and the confirmation still plays. The user must never see an error,
   spinner, or retry button on the capture path.
2. **Capture never asks a question.** No titles, tags, folders, confirmation dialogs,
   or choices of any kind. Text in, keep, done.
3. **Verbatim in.** The app never rewrites, trims (beyond whitespace), titles, or
   "cleans up" the user's words.
4. **Under 10 seconds** from app launch to captured-and-gone. Keyboard is already up
   when the capture screen appears. No splash, no loading state.
5. **Vocabulary:** never use "done", "complete", "archive", "inbox", "process",
   "task", "note" in UI copy or identifiers exposed to the user. Thoughts are
   *kept*. The app is quiet; it does not congratulate, streak, or nudge.

## Configuration

- Convex deployment: `https://hidden-penguin-861.convex.cloud`
- Clerk publishable key: `pk_test_ZW5hYmxpbmctd29sZi0yMi5jbGVyay5hY2NvdW50cy5kZXYk`
- Bundle IDs: app `com.srinivasib.drft`, widget extension `com.srinivasib.drft.DrftWidget`
- App Group: `group.com.srinivasib.drft`
- URL scheme: `drft` (deep link `drft://capture` opens the capture screen)
- Deployment target: iOS 18.0, iPhone only (`TARGETED_DEVICE_FAMILY = 1`),
  portrait only. Swift 6 language mode if dependencies allow, else Swift 5 mode.
- No code signing decisions in the project file: leave `DEVELOPMENT_TEAM` unset;
  builds must pass with `CODE_SIGNING_ALLOWED=NO` against the simulator.

## Dependencies (Swift Package Manager)

- `https://github.com/clerk/clerk-ios` — auth
- `https://github.com/get-convex/convex-swift` — Convex client
- `https://github.com/clerk/clerk-convex-swift` — bridges Clerk sessions into the
  Convex client (use this instead of hand-rolling token plumbing)

## Backend surface used

Exactly one mutation: `thoughts:capture` with `{ text: string }` → returns the new
thought id. Auth is a Clerk JWT (template name `convex`); the clerk-convex-swift
bridge handles attaching it. Everything else (enrichment, questions, linking) is
server-side and invisible to this app.

## Project structure

```
apps/ios/
  drft.xcodeproj            (objectVersion 77, filesystem-synchronized groups)
  drft/                     app target
    App/                    DrftApp entry, root routing (signed out → SignIn, else Capture)
    Features/
      Capture/              CaptureView + CaptureModel
      Settings/             SettingsView
      SignIn/               SignInView
    Services/
      ConvexService         Convex client + capture(text:) — enqueue-first, then flush
      AuthService           Clerk wrapper: load, session state, sign out
      CaptureQueue          durable on-device queue in the App Group container
      DictationService      SFSpeechRecognizer + AVAudioEngine, on-device
    Shared/
      Stillness/            design tokens (colors, type, spacing), small components (Hairline, NowDot)
  DrftWidget/               widget extension target
```

## Design system — "Stillness"

Near-monochrome. Helvetica Neue, light weights. Hairlines instead of boxes, air
instead of chrome. Color is spent in exactly one place: a vermilion dot.
Both light and dark, following the system setting.

| token    | light     | dark      |
|----------|-----------|-----------|
| page     | `#FAFAF8` | `#131311` |
| surface  | `#FCFCFB` | `#181816` |
| ink      | `#2B2B28` | `#EAEAE5` |
| muted    | `#75756F` | `#A0A099` |
| hairline | `#E8E8E4` | `#2B2B28` |
| now (dot)| `#C73E1D` | `#D9502A` |

`faint` = muted at 60% opacity. Define all of these as dynamic `Color`s in
`Shared/Stillness` (asset catalog or `UIColor(dynamicProvider:)`). Never use system
accent colors, system grays, or default button styling.

Typography (Helvetica Neue; sizes derived from the design mock, scaled to a 393pt
screen — treat as the starting point, keep proportions):

- **Wordmark** "drft": 15pt, weight .regular, lowercase, tracking ~0.5em, faint.
- **Thought text** (the input): 30pt, weight .light (300), line spacing ~1.5–1.65,
  ink, centered.
- **Timestamp line**: 13pt, uppercase, tracking ~0.3em, faint.
- **Action labels** (speak / keep): 15pt, uppercase, tracking ~0.3em. `speak` in
  muted; `keep` in ink, preceded by the vermilion dot (10pt circle, 12pt gap).
- Wide-tracked uppercase labels everywhere labels appear; generous whitespace;
  no borders except 1px hairlines.

## Screens

### Capture (the app)

Layout, top to bottom, on `page` background:

1. Wordmark `drft` centered at the top (below safe area). Tapping it opens Settings
   as a sheet. This is the only navigation in the app.
2. Flexible space, then the thought input, vertically centered: a borderless,
   chromeless multiline `TextField`/`TextEditor` (no placeholder text, no
   background, no border), 30pt light, centered text. The keyboard is up and the
   field focused **immediately on appear** — launch straight into typing.
3. Beneath the input: the timestamp line — current time + `· unfiled`, e.g.
   `21:47 · UNFILED` (24h or locale time, uppercase, tracked). Static label,
   updates with the clock; purely ambient.
4. Bottom row (above keyboard/safe area): `SPEAK` and `● KEEP`, centered,
   ~40pt apart. Plain text buttons — no capsules, no backgrounds.

Behavior:

- **keep** (enabled only when trimmed text is non-empty; when empty it sits at 35%
  opacity, still never throws an error): on tap —
  1. Capture the text into the queue *synchronously* (this cannot fail).
  2. Play the confirmation: the input text fades out (~0.25s), the vermilion dot
     appears alone at screen center, holds ~0.6s, fades. One soft haptic
     (`.impact(.light)` or `.success` — pick the quieter). No text, no checkmark,
     no toast.
  3. Reset to an empty focused field, ready for the next thought. If the app was
     opened from the widget, it is fine to remain on the empty capture screen —
     the user swipes away; do not auto-exit the app.
  4. Meanwhile, async: flush the queue to Convex. Success or failure changes
     nothing visually.
- **speak**: toggles dictation. While listening, the label swaps to `LISTENING`
  in ink with the dot pulsing gently beside it; transcribed words stream into the
  input live (verbatim, on-device). Tapping again (or tapping keep) stops
  transcription. Keep works identically on dictated text. If speech/mic permission
  is denied, tapping speak opens the system settings prompt path — never an alert
  explaining failure mid-capture.
- Sign-out or auth expiry mid-session must not interrupt an in-progress capture;
  queued items wait for the next signed-in flush.

### Sign-in (shown only when signed out)

Same stillness: `page` background, wordmark large-ish center (`drft`, tracked,
light), one line of muted copy beneath — `a space for unfinished thoughts` —
and a single hairline-underlined text button `sign in` that starts the Clerk
OAuth flow (use the Clerk iOS SDK's auth presentation for whichever OAuth
providers the instance has enabled; do not build username/password UI).
No feature list, no carousel, no branding beyond the wordmark.

### Settings (sheet over capture)

Nearly empty by design. A sheet on `surface` with:

- `SETTINGS` label (tracked caps, faint) at top.
- Signed-in identity (email, muted, plain text).
- `daily thought` — a time picker (compact) for the future daily resurfacing push,
  stored locally in `@AppStorage("dailyThoughtTime")` in the App Group defaults.
  Phase 5 will read it. Default 8:00. One line of faint copy: `one thought returns
  each morning · arrives with phase 5`.
- `sign out` — muted text button. Confirmation-free.
- App version, faint, bottom.

No other options. Rows separated by hairlines, no grouped-table chrome.

## Services

### CaptureQueue (the never-fail guarantee)

- Durable FIFO stored as JSON files (one per capture: id, text, createdAt) in the
  App Group container — atomic writes, survives force-quit and offline restarts.
- `enqueue(text)` is synchronous and infallible from the caller's perspective.
- Flush triggers: app becomes active, after every enqueue, network path becomes
  satisfied (`NWPathMonitor`), and after sign-in. Sends oldest-first via
  `thoughts:capture`; deletes an item only after the mutation returns its id.
  Retries with backoff; duplicates are acceptable, silent loss is not.

### AuthService / ConvexService

- Clerk configured at launch with the publishable key; clerk-convex-swift keeps
  the Convex client authenticated. Expose simple `isSignedIn` state to routing.
- ConvexService owns the client and `capture(text:)`; nothing else.

### DictationService

- `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`, fed by
  `AVAudioEngine`; partial results streamed to the caller. Info.plist strings
  (`NSSpeechRecognitionUsageDescription`, `NSMicrophoneUsageDescription`) written
  in the product's quiet voice, e.g. "drft turns your spoken thoughts into text,
  on this device."

## Widget (DrftWidget target)

Widgets are launchers — they deep-link into capture (`drft://capture`); no inline
text entry.

- **Lock screen** `accessoryCircular`: the vermilion dot, small, centered — nothing
  else. `accessoryRectangular`: `drft` wordmark + one faint line `catch a thought`.
- **Home screen** `systemSmall`: page background, small vermilion dot centered,
  `drft` wordmark beneath in tracked caps. Quiet; no counts, no content preview.
- **App Intent**: `CaptureThoughtIntent` (title "Capture a thought") that opens the
  app to capture — makes Shortcuts / Action button / Siri entry work.
- Widget shows no user data, so it needs no auth.

## Out of scope for phase 4

Push notifications / APNs, resurfacing, any reading surface, share extension,
iPad, Live Activities, onboarding beyond sign-in.

## Verification

Every stage must leave the project building cleanly:

```
cd apps/ios && xcodebuild -project drft.xcodeproj -scheme drft \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

No warnings introduced where avoidable; no `Any`-typed escape hatches; no
force-unwraps on the capture path.
