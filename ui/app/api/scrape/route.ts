import { NextResponse } from "next/server";
import { getDbForProject, ensureWikiTable } from "@/lib/db-project";

export const dynamic = "force-dynamic";

interface ScrapeRequestBody {
  url: string;
  projectDir: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scrapeWithRetry(
  client: any,
  url: string
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Firecrawl v4 uses FirecrawlClient.scrape() — not .scrapeUrl()
      const result: unknown = await client.scrape(url, { formats: ["markdown"] });

      // Handle different SDK response shapes
      if (result && typeof result === "object") {
        const obj = result as Record<string, unknown>;
        const content = obj.markdown ?? obj.content ?? "";
        if (typeof content === "string" && content.length > 0) return content;
      }
      if (typeof result === "string" && result.length > 0) return result;

      // If we got empty content, try once more
      if (attempt === 0) continue;
      return "";
    } catch {
      if (attempt === 0) continue;
      throw new Error("Failed to scrape URL after 2 attempts");
    }
  }
  return "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ScrapeRequestBody;

    const url = body.url?.trim();
    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: "URL must start with http:// or https://" },
        { status: 400 }
      );
    }

    const projectDir = body.projectDir?.trim();
    if (!projectDir) {
      return NextResponse.json(
        { error: "projectDir is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: "Firecrawl API key not configured",
        skipped: true,
      });
    }

    const { FirecrawlClient } = await import("@mendable/firecrawl-js");
    const client = new FirecrawlClient({ apiKey });

    const markdown = await scrapeWithRetry(client, url);

    if (!markdown) {
      return NextResponse.json({
        success: false,
        error: "No content extracted from URL",
      });
    }

    // Compose content with frontmatter
    const content = `---\nurl: ${url}\nscraped_at: ${new Date().toISOString()}\n---\n${markdown}`;

    const db = getDbForProject(projectDir);
    try {
      ensureWikiTable(db);

      db.prepare(
        `INSERT INTO wiki_articles (slug, title, section, content, created_by, updated_by)
         VALUES ('website-landing-page', 'Website Landing Page', 'overview', ?, 'setup-wizard', 'setup-wizard')
         ON CONFLICT(slug) DO UPDATE SET
           content = excluded.content,
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`
      ).run(content);
    } finally {
      db.close();
    }

    return NextResponse.json({ success: true, slug: "website-landing-page" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Scrape failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
