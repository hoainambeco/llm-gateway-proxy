/**
 * Moves one entry to a new slot and leaves everything else in order.
 *
 * Pure and total: an out-of-range or no-op move returns a copy unchanged, so a
 * view can hand the result straight to its save path without guarding.
 */
export function reorderByIndex<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...items];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length
  ) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}