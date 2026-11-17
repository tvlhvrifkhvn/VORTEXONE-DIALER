// Background polls that pause while the tab is hidden (another tab, a
// minimised window) and catch up at once when it's shown again. Every open
// tab shares the user's 100 requests a minute (rateLimit.js), so a forgotten
// tab must not spend them.
//
//   useEffect(() => pollWhileVisible(load, 10000), [load]);
// Returns the cleanup. The caller makes the first call itself, as before.
export function pollWhileVisible(fn, ms) {
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const id = setInterval(() => {
    if (!hidden()) fn();
  }, ms);
  const onVisible = () => {
    if (!hidden()) fn();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(id);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
