/** Parse pagination query params (ported from ui/lib/api-helpers.ts). */
export function parsePagination(
  query: Record<string, string | undefined>,
  defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {},
): { page: number; pageSize: number; offset: number } {
  const maxPageSize = defaults.maxPageSize ?? 200;
  let page = parseInt(query.page ?? '', 10);
  if (isNaN(page) || page < 1) page = defaults.page ?? 1;

  let pageSize = parseInt(query.pageSize ?? '', 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = defaults.pageSize ?? 50;
  if (pageSize > maxPageSize) pageSize = maxPageSize;

  return { page, pageSize, offset: (page - 1) * pageSize };
}
