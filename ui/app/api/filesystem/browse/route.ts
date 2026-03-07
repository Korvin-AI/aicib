import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";

const MAX_ENTRIES = 200;

export async function GET(req: NextRequest) {
  try {
    const rawPath = req.nextUrl.searchParams.get("path") || os.homedir();
    const dirPath = path.resolve(rawPath);
    const homePath = os.homedir();

    if (!fs.existsSync(dirPath)) {
      return NextResponse.json(
        { error: `Path does not exist: ${dirPath}` },
        { status: 400 }
      );
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: `Not a directory: ${dirPath}` },
        { status: 400 }
      );
    }

    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      return NextResponse.json(
        { error: `Cannot read directory: ${dirPath}` },
        { status: 400 }
      );
    }

    names.sort((a, b) => a.localeCompare(b));

    const entries: { name: string; path: string }[] = [];

    for (const name of names) {
      if (name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, name);
      try {
        const s = fs.statSync(fullPath);
        if (s.isDirectory()) {
          entries.push({ name, path: fullPath });
        }
      } catch {
        // skip inaccessible entries
      }
      if (entries.length >= MAX_ENTRIES) break;
    }

    const parentPath = path.dirname(dirPath);

    return NextResponse.json({
      currentPath: dirPath,
      parentPath: parentPath !== dirPath ? parentPath : null,
      homePath,
      entries,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
