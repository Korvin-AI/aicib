import { test, expect } from "@playwright/test";

/**
 * Sidebar navigation smoke tests.
 *
 * These tests verify that the sidebar nav links from sidebar.tsx are present
 * and that clicking them does not produce a server error (500).
 *
 * Real nav items (from source code):
 *   /          -> Home       (LayoutDashboard icon)
 *   /tasks     -> Tasks      (ListTodo icon)
 *   /activity  -> Activity   (Activity icon)
 *   /agents    -> Team       (Users icon)
 *   /hr        -> HR         (UserCog icon)
 *   /knowledge -> Wiki       (BookOpen icon)
 *   /journal   -> Journal    (Notebook icon)
 *   /projects  -> Projects   (FolderKanban icon)
 *   /costs     -> Costs      (DollarSign icon)
 *   /settings  -> Settings   (Settings icon)
 *
 * Note: The app may redirect to /setup or /businesses/new if no
 * config/business is bootstrapped. Tests handle both scenarios.
 */

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Tasks", href: "/tasks" },
  { label: "Activity", href: "/activity" },
  { label: "Team", href: "/agents" },
  { label: "HR", href: "/hr" },
  { label: "Wiki", href: "/knowledge" },
  { label: "Journal", href: "/journal" },
  { label: "Projects", href: "/projects" },
  { label: "Costs", href: "/costs" },
  { label: "Settings", href: "/settings" },
] as const;

test.describe("Sidebar navigation smoke", () => {
  test("sidebar renders with all expected nav links", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // If we got redirected to a setup/bootstrap page, the sidebar may not
    // be present (setup uses a different layout). In that case, skip gracefully.
    const sidebar = page.locator("aside");
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (!sidebarVisible) {
      // We were likely redirected to /setup or /businesses/new which uses
      // a different layout without the sidebar. That is a valid state.
      test.skip(true, "Sidebar not visible (likely redirected to setup flow)");
      return;
    }

    // Verify each expected nav link exists within the sidebar.
    for (const item of NAV_ITEMS) {
      const link = sidebar.locator(`a[href="${item.href}"]`);
      await expect(
        link,
        `Nav link "${item.label}" (${item.href}) should be visible`
      ).toBeVisible({ timeout: 5_000 });

      // Verify the link text matches the expected label.
      await expect(link).toContainText(item.label);
    }
  });

  test("clicking each nav link renders a page without a 500 error", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator("aside");
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (!sidebarVisible) {
      test.skip(true, "Sidebar not visible (likely redirected to setup flow)");
      return;
    }

    for (const item of NAV_ITEMS) {
      // Navigate by clicking the sidebar link.
      const link = sidebar.locator(`a[href="${item.href}"]`);
      await link.click();

      // Wait for navigation to settle.
      await page.waitForLoadState("networkidle");

      // The URL should reflect the expected route (or at least not be an error page).
      // We check that the page did not crash with a 500-style error.
      // Next.js shows error overlays or "Internal Server Error" text on 500s.
      const body = page.locator("body");
      await expect(body).toBeVisible();

      // Verify no "Internal Server Error" or similar crash text.
      const bodyText = await body.textContent();
      expect(
        bodyText,
        `Page ${item.href} should not show Internal Server Error`
      ).not.toContain("Internal Server Error");

      // Verify no Next.js error overlay.
      const nextErrorOverlay = page.locator("nextjs-portal");
      await expect(nextErrorOverlay).toHaveCount(0);
    }
  });

  test("nav links have correct href attributes", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator("aside");
    const sidebarVisible = await sidebar.isVisible().catch(() => false);

    if (!sidebarVisible) {
      test.skip(true, "Sidebar not visible (likely redirected to setup flow)");
      return;
    }

    // Collect all <a> elements inside the sidebar nav.
    const navLinks = sidebar.locator("nav a");
    const linkCount = await navLinks.count();

    // We expect at least the 10 nav items defined in sidebar.tsx.
    expect(linkCount).toBeGreaterThanOrEqual(NAV_ITEMS.length);

    // Verify each link points to a known route.
    const knownHrefs = new Set(NAV_ITEMS.map((item) => item.href));
    for (let i = 0; i < linkCount; i++) {
      const href = await navLinks.nth(i).getAttribute("href");
      expect(
        href,
        `Nav link at index ${i} should have an href`
      ).not.toBeNull();
      expect(
        knownHrefs.has(href!),
        `Nav link href "${href}" should be a known route`
      ).toBe(true);
    }
  });
});
