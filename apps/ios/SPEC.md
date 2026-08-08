# drft iOS — Spec

The iOS app is capture first: widget, dictation, keep, gone. Behind capture sits
**the shelf** — a quiet, non-editing view of the collection (pull capture down to
reveal it, re-read a thought, set it to rest). The phone captures and glances;
deeper collection work happens on the web. Phase 4 shipped capture-only; phase 6
adds the shelf.

## Hard rules (product contract, non-negotiable)

1. **Capture never fails visibly.** If the network is down, the fragment queues
   on-device and the confirmation still plays. The user must never see an error,
   spinner, or retry button on the capture path.
2. **Capture never asks for anything else.** No titles, tags, folders, confirmation
   dialogs, or choices of any kind. Text in, keep, done.
3. **Verbatim in.** The app never rewrites, trims (beyond whitespace), titles, or
   "cleans up" the user's words.
4. **Under 10 seconds** from app launch to captured-and-gone. Keyboard is already up
   when the capture screen appears. No splash, no loading state.
5. **Vocabulary:** never use "done", "complete", "archive", "inbox", "process",
   "task", "note" in UI copy or identifiers exposed to the user. Thoughts are
   *kept*. The app is quiet; it does not congratulate, streak, or nudge.

## Configuration

- Convex deployment: Debug uses `https://hidden-penguin-861.convex.cloud`;
  Release uses `https://optimistic-stork-701.convex.cloud`.
- Clerk publishable key: configured per build. Debug and Release currently use
  the same Clerk test instance; Release can move independently to a `pk_live_…`
  key when production Clerk is enabled.
- Bundle IDs: app `com.srinivasib.drft`, widget extension `com.srinivasib.drft.DrftWidget`
- App Group: `group.com.srinivasib.drft`
- URL scheme: `drft` (deep link `drft://capture` opens the capture screen)
- Deployment target: iOS 18.0, iPhone only (`TARGETED_DEVICE_FAMILY = 1`),
  portrait only. Swift 6 language mode if dependencies allow, else Swift 5 mode.
- Code signing: the personal development team (`3SN533K2V4`) is pinned on both
  targets so device installs work; simulator builds must still pass with
  `CODE_SIGNING_ALLOWED=NO`.

## Dependencies (Swift Package Manager)

- `https://github.com/clerk/clerk-ios` — auth
- `https://github.com/get-convex/convex-swift` — Convex client
- `Vendor/clerk-convex-swift` — local fork of Clerk's `clerk-convex-swift`
  bridge. It requests Clerk's default session token, which both Clerk instances
  issue with the `convex` audience. The legacy `convex` JWT template remains
  configured in Clerk as a rollout fallback but is not requested by iOS.

## Backend surface used

- `thoughts:capture` mutation with `{ text: string }` → returns the new thought id.
- `thoughts:collection` query with `{ date: "YYYY-MM-DD" }` (client-local date) →
  `{ thoughts: [{ _id, preview, createdAt }], resurfacedId | null }` — open
  thoughts newest-first; `resurfacedId` is today's returned thought
  (force-included in the list).
- `thoughts:view` query with `{ thoughtId }` → `null` or the full thought:
  `{ _id, text, createdAt, status, connections, ... }`; connections supply the
  related-thought list, including each thought's text, capture time, and status.
- `thoughts:rest` mutation with `{ thoughtId, note? }` → sets the thought down.
- `thoughts:dismissConnection` / `thoughts:undismissConnection` mutations with
  `{ connectionId }` → set a related thought aside or restore it.
- `settings:get` query with no args → returns the daily email settings or `null`.
- `settings:save` mutation with `{ sendTime, timezone, email? }` → writes the daily
  email settings.

No codegen: results are decoded into hand-written Swift `Decodable` mirrors of the
Convex validators. Reads use live subscriptions so the shelf updates in real time.

Auth is a Clerk JWT (template name `convex`); the clerk-convex-swift bridge handles
attaching it. Everything else (enrichment and linking) is server-side and invisible
to this app.

## Project structure

```
apps/ios/
  drft.xcodeproj            (objectVersion 77, filesystem-synchronized groups)
  drft/                     app target
    App/                    DrftApp entry, root routing (signed out → SignIn, else Capture)
    Features/
      Capture/              CaptureView + CaptureModel
      Shelf/                ShelfView (collection list) + ThoughtView (single thought)
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
- **Pull down to the shelf**: capture is the front layer; the shelf sits behind it.
  A committed downward drag anywhere on the capture screen slides the whole capture
  layer off the bottom edge, keyboard dropping with it in the same motion, revealing
  the shelf. Small drags keep behaving as interactive keyboard dismissal — use a
  simultaneous gesture with a vertical threshold so the two don't fight. Returning
  (see Shelf), capture rises from the bottom like a sheet, field already focused,
  keyboard rising with it.
- **A draft survives the trip.** Swiping down with text in the field never discards
  or auto-keeps it; the words remain when capture rises again.
- **Every entry lands on capture.** Cold launch, widget, `drft://capture`, the App
  Intent — always the empty (or draft-holding) focused field. The shelf is
  session-transient, never the resume state.

### Shelf (behind capture)

`page` background, same wordmark at top (tap → Settings sheet, same as capture).
Below, a scrolling non-editing list of the open collection, driven by a live
`thoughts:collection` subscription (client-local date, recomputed when the app
becomes active so midnight rolls over):

1. **Today's returned thought**, when `resurfacedId` is set: pinned above the
   groups, held apart by whitespace, under a tracked-caps faint label
   `RETURNED TODAY`. Same row treatment otherwise.
2. **Groups** `TODAY` / `THIS WEEK` / `EARLIER` (tracked caps, faint, computed
   client-side from `createdAt`; empty groups are omitted). Rows: first-line
   verbatim `preview`, 17–18pt light, ink, hairline-separated. Tapping a row opens
   the Thought view.
3. **The new-thought bar**, fixed above the safe area: a full-width vermilion
   (`now`-filled) rounded rect — 14pt continuous corners, 24pt side margins,
   54pt tall — with `NEW THOUGHT` centered in near-white (`onNow`) tracked caps.
   (Chosen design: `docs/shelf-button.html`, variant 07b.) Tapping it raises
   capture; pressed state dims to ~70% opacity — no scale, no bounce. When a
   draft exists, the label shows the draft's first words instead — lowercase,
   lightly tracked, truncated.

**No counts anywhere, ever** — not in groups, not on the app icon. Empty state is
near-silence: wordmark, whitespace, the bottom affordance. No copy.

### Thought (from a shelf row)

Slides in over the shelf with a quiet back affordance (a faint `←`, no nav bar).
The capture timestamp sits centered in that quiet header. Below it:

1. The verbatim text is held at the center of the available reading area, 24–26pt
   light, ink — a step below capture's 30pt; here you read, not write. Selectable,
   never editable.
2. When related thoughts exist, a left-aligned `RELATED THOUGHTS` list follows
   after a wide field of space. Rows show the complete thought in sentence case,
   wrap without truncation, and carry a quiet capture-age or `SET DOWN` label.
   Tapping follows the thought; back returns through followed thoughts before the
   shelf. A trailing swipe reveals `SET ASIDE`, followed by an eight-second undo.
   With no related thoughts, the entire section is absent.
3. `REST`, tracked caps, muted, waits at the bottom. Tapping it reveals a single
   borderless one-line field for the optional closing line (mirror the web's
   resting-note copy from `apps/web/src/routes/thought.$thoughtId.tsx`) with a
   quiet confirm; resting with or without a note fades the thought and returns
   to the shelf. Resting from the phone is one-way — wake stays on the web.

No search or resting list. Those remain web surfaces.

### Sign-in (shown only when signed out)

Same stillness: `page` background, wordmark large-ish center (`drft`, tracked,
light), one line of muted copy beneath — `a space for unfinished thoughts` —
and one quiet text button per enabled OAuth provider (`google` / `github`) —
tracked caps with the provider mark, each starting Clerk's OAuth
flow directly (do not build username/password UI). No feature list, no
carousel, no branding beyond the wordmark.

### Settings (sheet over capture)

Nearly empty by design. A sheet on `surface` with:

- `SETTINGS` label (tracked caps, faint) at top.
- Signed-in identity (email, muted, plain text).
- `daily thought` — a time picker (compact) for the daily resurfacing email.
  Convex is the source of truth because the server sends the email. On appear,
  the picker adopts the signed-in user's server value when one exists. Changes
  save to Convex with the current IANA timezone and Clerk email, while
  `@AppStorage("dailyThoughtTime")` in the App Group defaults remains the offline
  cache and initial value. Default 8:00 when neither source has a value. One line
  of faint copy: `one thought returns each morning`.
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
- ConvexService owns the client, capture mutation, and daily-thought settings
  query/mutation.

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

## Out of scope

Wake, search, the resting list, share extension, iPad, Live
Activities, onboarding beyond sign-in.

Push notifications / APNs are not merely deferred — the daily return ships as
email instead (see `docs/experience.html` §03). The phone captures; it is not a
delivery channel. Nothing in this app needs a push entitlement.

## Verification

Every stage must leave the project building cleanly:

```
cd apps/ios && xcodebuild -project drft.xcodeproj -scheme drft \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

No warnings introduced where avoidable; no `Any`-typed escape hatches; no
force-unwraps on the capture path.
