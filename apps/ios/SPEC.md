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
- `account:deleteAccount` action with `{ appleAuthorizationCode? }` → deletes the
  Clerk user and everything stored for it. Once it returns the deletion is final;
  the server finishes the purge and retries the Clerk removal on its own.
- `consent:get` query with no args → `null` (never asked) or `{ aiConnections }`;
  live-subscribed only while Convex is authenticated, since it also answers `null`
  signed out.
- `consent:setAiConnections` mutation with `{ allowed }` → records the decision.
  The server sends thought text to OpenAI (connections) only once allowed.

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
      Stillness/            design tokens (colors, type, spacing), Geist fonts, Wordmark, Hairline, NowDot — shared with the widget
      Ember/                app-only Ember components (Phosphor icons, badges, chips, button styles, HomeHeader)
  DrftWidget/               widget extension target
```

## Design system — Ember

The same look as the web app: the Stillness palette (`docs/design.html`) worn the
Ember way (`docs/vivid.html#ember`). Geist at a readable weight, sentence case
(no tiny spaced capitals), Phosphor icons, 10pt surfaces and pill controls, and
the vermilion promoted from a single dot to the accent for "now". Both light and
dark, following the system setting. Tokens mirror `apps/web/src/index.css` and
live in `Shared/Stillness` (shared with the widget); app-only components
(icons, badges, chips, pill/icon/row button styles, `HomeHeader`) live in
`Shared/Ember`.

| token          | web       | light     | dark      |
|----------------|-----------|-----------|-----------|
| page           | `--pg`    | `#FAFAF8` | `#131311` |
| surface        | `--scr`   | `#FCFCFB` | `#181816` |
| ink            | `--ink`   | `#2B2B28` | `#EAEAE5` |
| muted          | `--mut`   | `#75756F` | `#A0A099` |
| hairline       | `--line`  | `#E8E8E4` | `#2B2B28` |
| now            | `--dot`   | `#C73E1D` | `#D9502A` |
| onNow          | `--on-dot`| `#FAFAF8` | `#131311` |
| chromeText     | `--pt`    | `#45453F` | `#C9C9C2` |
| chromeLabel    | `--pl`    | `#6B6B65` | `#97978F` |
| nowTint        | `--tint`  | `#F8ECE7` | `#281B16` |
| nowTintStrong  | `--tint-2`| `#F7E1DA` | `#3A2219` |
| nowInk         | `--dot-ink`| `#A33E25` | `#E48367` |
| nowEdge        | `--dot-edge`| `#E0A08E` | `#7F412F` |

The Ember tints are the web's `color-mix(in oklab, …)` values, precomputed.
Never use system accent colors, system grays, or default button styling.

- **Type**: Geist (`Shared/Stillness/Fonts`, registered via `UIAppFonts` in both
  targets), 400 body, 500–600 headings and controls, 13pt minimum for anything
  you read. Capture field 28pt, re-read thought 25pt, rows 16pt, body 15pt,
  times and captions 13pt with tabular digits.
- **Wordmark**: vermilion 8pt dot + `drft`, 17pt semibold, ink.
- **Icons**: the web's Phosphor icons, bundled as template vectors in
  `Assets.xcassets/Phosphor`.
- **Controls**: pills. Solid vermilion for the one action that matters (Keep,
  New thought, Allow, Set it down); outlined vermilion for resting; hairline or
  quiet pills beside them. Pressed rows and controls take the `nowTint` wash.
- **Counts**: tinted badges for each group, related thoughts, and the
  collection total, as on the web.

## Screens

### Capture (the app)

Layout, top to bottom, on `page` background:

1. Header: the wordmark on the left, a gear on the right. Either opens Settings
   as a sheet. This is the only navigation in the app.
2. Flexible space, then the thought input, vertically centered: a borderless,
   chromeless multiline `TextField`/`TextEditor` (no placeholder text, no
   background, no border), 30pt light, centered text. The keyboard is up and the
   field focused **immediately on appear** — launch straight into typing.
3. Above the input: the time line, e.g. `9:41 pm, unfiled` (locale time,
   lowercase), as on the web. Updates with the clock; purely ambient.
4. Bottom row (above keyboard/safe area): `Speak` (hairline pill with a
   microphone) and `Keep` (solid vermilion pill), centered.

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
- **speak**: toggles dictation. While listening, the pill turns vermilion-outlined and
  reads `Listening` with the dot pulsing gently beside it; transcribed words stream into the
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

`page` background, same header as capture (wordmark + gear → Settings sheet), with
a tinted `N thoughts` badge for the collection total.
Below, a scrolling non-editing list of the open collection, driven by a live
`thoughts:collection` subscription (client-local date, recomputed when the app
becomes active so midnight rolls over):

1. **Today's returned thought**, when `resurfacedId` is set: pinned above the
   groups on a `nowTint` surface labelled `Back today` (with the web's
   arrow-bend icon), preview clamped to two lines.
2. **Groups** `Today` / `This week` / `Earlier` (13pt medium, each with a count
   badge; computed client-side from `createdAt`; empty groups are omitted). Rows:
   first-line verbatim `preview`, 16pt, ink, age on the right, hairlines between
   rows. Tapping a row opens the Thought view.
3. **New thought**, fixed at the bottom over a fade of the page: a solid
   vermilion pill with a plus icon. Tapping it raises capture.

No count on the app icon. Empty state is near-silence: header, whitespace, the
bottom affordance. No copy.

### Thought (from a shelf row)

Slides in over the shelf with a round back-arrow button, no nav bar. The capture
date sits centered in that header as a sentence (`Tuesday, 9:41 am`). Below it:

1. The verbatim text, left-aligned in the middle of the reading area, 25pt —
   a step below capture's 28pt; here you read, not write. Selectable, never
   editable. Chips beneath show where it has been: `Returned today` (tinted) and
   `Set down` (quiet, with its age), then the resting note.
2. When related thoughts exist, a `Related thoughts` list (with a count badge)
   follows. Rows show the complete thought, wrap without truncation, and carry
   the capture age or a `Set down` tag. Tapping follows the thought; back
   returns through followed thoughts before the shelf. A trailing swipe reveals
   `Set aside`, followed by an eight-second undo. With no related thoughts, the
   entire section is absent.
3. `Let it rest`, an outlined vermilion pill, waits at the bottom. Tapping it
   reveals a one-line field (`Where it landed (optional)`, the web's copy) with
   `Set it down` / `Not yet`; resting with or without a note fades the thought
   and returns to the shelf. Resting from the phone is one-way — wake stays on
   the web.

No search or resting list. Those remain web surfaces.

### Sign-in (shown only when signed out)

As on the web: `page` background, the large wordmark centered, one line beneath
— `A space for unfinished thoughts` — and one pill per provider (`Continue with
Apple` / `Google` / `GitHub`, with its Phosphor mark), each starting Clerk's
sign-in directly (do not build username/password UI). A `Privacy policy` link
sits at the bottom edge. No feature list, no carousel, no branding beyond the
wordmark.

### Connections permission (once)

When signed in and `consent:get` answers `null`, a full-screen `page` view rises
over idle capture (empty field, not listening, no confirmation playing) — never
mid-thought, and never while the answer is unknown or offline. On a surface card
(as on the web): a `Connections` title, the explanation that each thought's text
is sent to OpenAI (which doesn't train on it), `Allow` (solid) / `Not now`
(hairline) pills, a failure line on error or an 8-second stall, `You can change
this anytime in settings.`, and a `Privacy policy` link. Deciding dismisses it and capture refocuses.

### Settings (sheet over capture)

Nearly empty by design. A sheet on `page` with a centered `Settings` title and a
close button, then rows grouped on surface cards as on the web:

- Signed-in identity (envelope icon, email).
- `Daily thought` — a time picker (compact) for the daily resurfacing email.
  Convex is the source of truth because the server sends the email. On appear,
  the picker adopts the signed-in user's server value when one exists. Changes
  save to Convex with the current IANA timezone and Clerk email, while
  `@AppStorage("dailyThoughtTime")` in the App Group defaults remains the offline
  cache and initial value. Default 8:00 when neither source has a value. One line
  of copy: `One thought returns each morning, <timezone>`.
- `Connections` — a vermilion switch reflecting the server consent (never asked reads as
  off), writing through `consent:setAiConnections`. Copy: `Thought text is
  sent to OpenAI to find echoes`.
- `Privacy policy` — link row to `https://trydrft.app/privacy`.
- `Sign out` — confirmation-free.
- `Delete account` — on its own card, in vermilion text. One system alert names what goes (every
  thought, connection, note, and the daily email) and that it can't be undone.
  An account signed in with Apple first confirms with Apple once, so the server
  can revoke the Sign in with Apple grant (best effort: dismissing that sheet, or
  another Apple ID on the device, skips revocation, never the deletion). On
  success the device forgets the account (queued captures, cached rows, the
  remembered user) and signs out; if the request never reached the server the
  row reads `Couldn't finish deleting. Try again.`
- App version at the bottom.

No other options. Rows separated by hairlines on 10pt surfaces, no system
grouped-table chrome.

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
  else. `accessoryRectangular`: the wordmark + one line `Catch a thought`.
- **Home screen** `systemSmall`: page background, the wordmark top-left and a
  tinted `Catch a thought` chip at the bottom. Quiet; no counts, no content preview.
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
