// Becomes true after the first client-side navigation. Components that mount
// after that came from navigation (not from hydrating server HTML), so they
// may play entrance effects such as counting up from zero.
let navigated = false;

export function markNavigated() {
  navigated = true;
}

export function hasNavigated() {
  return navigated;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
