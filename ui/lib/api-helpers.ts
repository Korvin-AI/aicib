import type Database from "better-sqlite3";
import { NextResponse } from "next/server";

export function isMissingTableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /no such table/i.test(error.message);
}

export function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName) as { name: string } | undefined;

  return !!row;
}

export function safeAll<T>(
  db: Database.Database,
  tableName: string,
  query: string,
  params: unknown[] = []
): T[] {
  if (!tableExists(db, tableName)) return [];
  try {
    return db.prepare(query).all(...params) as T[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

export function safeGet<T>(
  db: Database.Database,
  tableName: string,
  query: string,
  params: unknown[] = []
): T | null {
  if (!tableExists(db, tableName)) return null;
  try {
    return (db.prepare(query).get(...params) as T | undefined) ?? null;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

export interface PageParams {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePagination(
  request: Request,
  defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {}
): PageParams {
  const { page = 1, pageSize = 50, maxPageSize = 200 } = defaults;
  const { searchParams } = new URL(request.url);

  const rawPage = Number.parseInt(searchParams.get("page") || "", 10);
  const rawPageSize = Number.parseInt(searchParams.get("pageSize") || "", 10);

  const safePage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : page;
  const safePageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(rawPageSize, maxPageSize)
      : pageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
}

export function parseCsvParam(
  value: string | null,
  fallback: string[] = []
): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function jsonError(error: unknown, status = 500): NextResponse {
  if (status >= 500) {
    console.error(error);
    const message =
      process.env.NODE_ENV === "development" && error instanceof Error
        ? error.message
        : "Internal server error";
    return NextResponse.json({ error: message }, { status });
  }

  const message = error instanceof Error ? error.message : "Request failed";
  return NextResponse.json({ error: message }, { status });
}
