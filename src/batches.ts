/** Maps `items` through `work` a few at a time, in order: far faster than one by one when each step waits on a file, without opening hundreds of reads at once. */
export async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>, size = 16): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) results.push(...await Promise.all(items.slice(start, start + size).map(work)));
  return results;
}
