import path from "node:path";
import { NextResponse } from "next/server";
import { getDbForProject, ensureWikiTable } from "@/lib/db-project";
import { isCloudMode } from "@/lib/cloud-mode";

export const dynamic = "force-dynamic";

function slugFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

async function extractText(
  buffer: Buffer,
  ext: string
): Promise<string> {
  switch (ext) {
    case ".md":
    case ".txt":
      return buffer.toString("utf-8");
    case ".pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      await parser.destroy();
      return result.text;
    }
    case ".docx": {
      const mammoth = await import("mammoth");
      const mdResult = await mammoth.extractRawText({ buffer });
      return mdResult.value;
    }
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

export async function POST(request: Request) {
  if (isCloudMode()) {
    return NextResponse.json({ error: "Upload not available in cloud mode" }, { status: 501 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectDir = formData.get("projectDir") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!projectDir?.trim()) {
      return NextResponse.json(
        { error: "projectDir is required" },
        { status: 400 }
      );
    }

    const ext = path.extname(file.name).toLowerCase();
    const allowed = [".md", ".txt", ".pdf", ".docx"];
    if (!allowed.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${ext}. Allowed: ${allowed.join(", ")}` },
        { status: 400 }
      );
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum 10MB." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buffer, ext);

    const slug = `doc-${slugFromFilename(file.name)}`;
    const title = file.name.replace(/\.[^.]+$/, "");

    const db = getDbForProject(projectDir.trim());
    try {
      ensureWikiTable(db);

      db.prepare(
        `INSERT INTO wiki_articles (slug, title, section, content, created_by, updated_by)
         VALUES (?, ?, 'general', ?, 'setup-wizard', 'setup-wizard')
         ON CONFLICT(slug) DO UPDATE SET
           content = excluded.content,
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`
      ).run(slug, title, text);
    } finally {
      db.close();
    }

    return NextResponse.json({ success: true, slug, title });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
