// 30-second refetch throttle for focus-driven screens.
//
// Switching tabs fires useFocusEffect on EVERY visit; without a throttle
// each visit refetches from the network. User-initiated refreshes
// (pull-to-refresh, retry buttons) bypass the cache with force=true, which
// also resets the timer so the next focus does not refetch immediately.
const lastFetch = new Map<string, number>();
const TTL_MS = 30_000;

/**
 * Returns true when the screen should fetch now. Records the fetch time,
 * so a later focus within 30s is skipped. Pass force=true for
 * pull-to-refresh / manual reloads: always fetches and resets the timer.
 */
export function shouldRefetch(key: string, force = false): boolean {
  if (force) {
    lastFetch.set(key, Date.now());
    return true;
  }
  const last = lastFetch.get(key) ?? 0;
  if (Date.now() - last < TTL_MS) return false;
  lastFetch.set(key, Date.now());
  return true;
}
