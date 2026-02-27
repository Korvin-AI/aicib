import { test, expect } from "@playwright/test";

/**
 * Dashboard (Homepage) smoke tests.
 *
 * These tests verify the most fundamental behavior of the AICIB dashboard:
 * the page loads without hard crashes, renders meaningful content, and
 * does not emit uncaught JavaScript errors.
 *
 * The app may redirect to /setup or /businesses/new if no config/business
 * exists, so tests account for that as a valid "page loaded" state.
 */

test.describe("Dashboard — homepage smoke", () => {
  test("page loads successfully without a hard error", async ({ page }) => {
    const response = await page.goto("/");
    // The server should respond (even if the page later redirects to setup).
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);

    // Wait for the page to settle — either the dashboard renders or
    // a redirect to /setup or /businesses/new happens, both are valid.
    await page.waitForLoadState("networkidle");

    // Verify no full-page error overlay from Next.js (the red error box).
    const nextErrorOverlay = page.locator("nextjs-portal");
    await expect(nextErrorOverlay).toHaveCount(0);
  });

  test("page has a visible heading", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The dashboard shows <h1>Home</h1>.
    // If redirected to /setup or /businesses/new, there will be a different heading.
    // Either way, at least one <h1> should be present.
    const heading = page.locator("h1").first();
    await expect(heading).toBeVisible({ timeout: 15_000 });

    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test("no uncaught JS console errors during load", async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        // Ignore known non-critical messages:
        // - Failed fetch calls (APIs not running during test)
        // - React hydration warnings in dev mode
        // - EventSource connection failures (SSE provider)
        const ignoredPatterns = [
          "Failed to fetch",
          "fetch",
          "ERR_CONNECTION_REFUSED",
          "NetworkError",
          "EventSource",
          "hydrat",
          "net::ERR",
          "NEXT_REDIRECT",
          "ChunkLoadError",
        ];
        const isIgnored = ignoredPatterns.some((pattern) =>
          text.toLowerCase().includes(pattern.toLowerCase())
        );
        if (!isIgnored) {
          consoleErrors.push(text);
        }
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Give the page a moment to settle (async effects, etc.)
    await page.waitForTimeout(2_000);

    expect(
      consoleErrors,
      `Unexpected console errors:\n${consoleErrors.join("\n")}`
    ).toHaveLength(0);
  });
});
