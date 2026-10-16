interface Page<T> {
  has_more: boolean;
  data: T[];
}

interface Cursor {
  limit?: number;
  after?: string;
  before?: string;
}

/**
 * Walks a cursor-paged list. Going forward (the default, or with `after`) it
 * passes the last id of each page as the next `after`; started with `before`,
 * it walks toward newer items, passing the first id as the next `before`.
 */
export async function* paginate<T extends { id: string }, P extends Cursor>(
  fetchPage: (params: P) => Promise<Page<T>>,
  params: P,
): AsyncGenerator<T, void, undefined> {
  const backward = params.before !== undefined;
  let cursor: P = params;
  for (;;) {
    const page = await fetchPage(cursor);
    yield* page.data;
    const edge = backward ? page.data[0] : page.data[page.data.length - 1];
    if (!page.has_more || edge === undefined) return;
    cursor = backward ? { ...cursor, before: edge.id } : { ...cursor, after: edge.id };
  }
}
