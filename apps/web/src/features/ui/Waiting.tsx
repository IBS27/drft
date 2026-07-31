// Nothing to show yet — a single quiet caret, not a spinner. The same
// mark the design doc blinks in its mockups.
export function Waiting() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <span className="caret h-5 w-px bg-faint" />
    </main>
  );
}
