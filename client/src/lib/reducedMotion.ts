/**
 * `prefers-reduced-motion` for the handful of things CSS can't express — an
 * auto-advancing step, a timed hold. `matchMedia` is missing in jsdom and in
 * older embedded webviews, so absence means "no preference expressed".
 */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
