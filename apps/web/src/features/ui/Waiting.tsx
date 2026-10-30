// Nothing to show yet: a single caret in the accent, not a spinner. The
// same mark the capture field blinks.
export function Waiting() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <span className="caret h-6 w-0.5 rounded-full bg-dot" />
    </main>
  );
}
