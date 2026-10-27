// Read a counted snapshot in bounded batches. Range order is preserved even
// when requests finish out of order; callers still receive every page.
export async function parallelPages<T>(
  load: (offset: number, count: boolean) => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }>,
  pageSize = 1000,
  concurrency = 4,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid pagination limits");
  const first = await load(0, true);
  if (first.error) throw first.error;
  if (first.count === null) throw new Error("Missing exact pagination count");
  const rows = [...(first.data ?? [])];
  for (let offset = pageSize; offset < first.count; offset += pageSize * concurrency) {
    const offsets = Array.from({ length: Math.min(concurrency, Math.ceil((first.count - offset) / pageSize)) }, (_, index) => offset + index * pageSize);
    const pages = await Promise.all(offsets.map(start => load(start, false)));
    for (const page of pages) {
      if (page.error) throw page.error;
      rows.push(...(page.data ?? []));
    }
  }
  return rows;
}
