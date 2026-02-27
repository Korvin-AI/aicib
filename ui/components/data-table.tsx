"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  emptyMessage?: string;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  getRowKey?: (row: T, index: number) => string;
}

type SortDirection = "asc" | "desc";

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  const aText = String(a).toLowerCase();
  const bText = String(b).toLowerCase();
  return aText.localeCompare(bText);
}

function defaultRowKey<T extends object>(row: T, index: number): string {
  const record = row as Record<string, unknown>;
  const preferred =
    record.id ??
    record.uuid ??
    record.key ??
    record.slug ??
    record.name ??
    record.title;
  if (preferred !== undefined && preferred !== null && String(preferred) !== "") {
    return String(preferred);
  }

  const timestamp = record.created_at ?? record.updated_at ?? record.timestamp;
  if (timestamp !== undefined && timestamp !== null && String(timestamp) !== "") {
    return `${String(timestamp)}-${index}`;
  }

  return `row-${index}`;
}

export function DataTable<T extends object>({
  rows,
  columns,
  emptyMessage = "No results",
  defaultPageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  getRowKey,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;

    const copy = [...rows];
    copy.sort((a, b) => {
      const left = (a as Record<string, unknown>)[sortKey];
      const right = (b as Record<string, unknown>)[sortKey];
      const result = compareValues(left, right);
      return sortDirection === "asc" ? result : -result;
    });
    return copy;
  }, [rows, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [safePage, pageSize, sorted]);

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortable) return;

    const key = String(column.key);
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection("asc");
      return;
    }

    setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
  }

  function sortIcon(column: DataTableColumn<T>) {
    if (!column.sortable) return null;
    if (sortKey !== String(column.key)) {
      return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    }

    return sortDirection === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-foreground" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-foreground" />
    );
  }

  return (
    <div className="rounded-lg border border-border/80 bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr className="border-b border-border/70 bg-muted/30">
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  className={cn(
                    "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                    column.headerClassName
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      className="inline-flex items-center gap-1.5"
                    >
                      {column.label}
                      {sortIcon(column)}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-[13px] text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row, index) => (
                <tr
                  key={
                    getRowKey
                      ? getRowKey(row, index)
                      : defaultRowKey(row, index)
                  }
                  className="border-b border-border/60 last:border-0"
                >
                  {columns.map((column) => (
                    <td
                      key={String(column.key)}
                      className={cn(
                        "px-3 py-2 text-[13px] text-foreground align-top",
                        column.className
                      )}
                    >
                      {column.render
                        ? column.render(row)
                        : String(
                            (row as Record<string, unknown>)[
                              String(column.key)
                            ] ?? "-"
                          )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded border border-border bg-background px-2 py-1 text-[12px]"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">
            Page {safePage} of {totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="h-7 text-[12px]"
          >
            Prev
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="h-7 text-[12px]"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
