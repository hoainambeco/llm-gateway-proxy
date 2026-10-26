import { reorderByIndex } from './reorder';

describe('reorderByIndex', () => {
  it('moves an item forward and keeps every other element in order', () => {
    expect(reorderByIndex(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward', () => {
    expect(reorderByIndex(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves an item to the last slot', () => {
    expect(reorderByIndex(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('returns an equal copy when from === to (a no-op move)', () => {
    const items = ['a', 'b', 'c'];
    const result = reorderByIndex(items, 1, 1);

    expect(result).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(items);
  });

  it.each([
    [-1, 1] as const,
    [1, -1] as const,
    [-5, -5] as const,
  ])('returns an unchanged copy for out-of-range negative indices from=%i, to=%i', (from, to) => {
    expect(reorderByIndex(['a', 'b', 'c'], from, to)).toEqual(['a', 'b', 'c']);
  });

  it.each([
    [3, 0] as const,
    [0, 3] as const,
    [99, 0] as const,
    [0, 99] as const,
  ])('returns an unchanged copy for out-of-range indices beyond the length from=%i, to=%i', (from, to) => {
    expect(reorderByIndex(['a', 'b', 'c'], from, to)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const items = ['a', 'b', 'c', 'd'];

    reorderByIndex(items, 0, 3);

    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('preserves element references, not clones', () => {
    const first = { id: 1 };
    const second = { id: 2 };
    const third = { id: 3 };

    const result = reorderByIndex([first, second, third], 0, 2);

    expect(result[2]).toBe(first);
    expect(result[0]).toBe(second);
    expect(result[1]).toBe(third);
  });
});
