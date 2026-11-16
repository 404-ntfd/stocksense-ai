// A tiny stack of "close me" callbacks. The Android back button (and Escape on desktop)
// closes the top-most sheet or dialog before any navigation happens.
type Closer = () => void;
const stack: Closer[] = [];

export function pushBack(fn: Closer): () => void {
  stack.push(fn);
  return () => {
    const i = stack.lastIndexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}
/** Runs the top closer. Returns false when nothing was open. */
export function popBack(): boolean {
  const fn = stack[stack.length - 1];
  if (!fn) return false;
  fn();
  return true;
}
export const backDepth = (): number => stack.length;
