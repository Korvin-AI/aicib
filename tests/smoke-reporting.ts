/**
 * Smoke test for Reporting & Performance Review modules.
 *
 * Verifies pure functions and SQL queries.
 * No API key needed — runs in seconds.
 *
 * Usage:
 *   cd aicib && npx tsx tests/smoke-reporting.ts
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// ── Imports from the modules under test ──────────────────────

import {
  computeReviewScores,
  deriveRecommendation,
  collectAgentMetrics,
  type AutoReviewMetrics,
} from "../src/core/perf-review.js";

import {
  ReportManager,
  VALID_DELIVERY_METHODS,
  type ReportTemplate,
  type ReportMetrics,
} from "../src/core/reporting.js";

// ── Test Harness ─────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ── Helper: Create temp project dir with minimal DB ──────────

function createTempProject(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aicib-test-"));
  const dataDir = path.join(dir, ".aicib");
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "state.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Create tables needed by the modules
  db.prepare(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_type TEXT NOT NULL,
    title TEXT NOT NULL,
    author_agent TEXT NOT NULL DEFAULT 'ceo',
    content TEXT NOT NULL DEFAULT '',
    metrics_snapshot TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    delivery_method TEXT NOT NULL DEFAULT 'file',
    schedule_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_to TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS cost_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_role TEXT NOT NULL,
    estimated_cost_usd REAL NOT NULL DEFAULT 0,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    agent_role TEXT NOT NULL,
    comment_type TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS auto_review_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_role TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    trigger_data TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    review_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  )`).run();

  db.close();
  return { dir, dbPath };
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════

console.log("=".repeat(60));
console.log("  Reporting & Performance Review — Smoke Test");
console.log("=".repeat(60));

// ── Fix 1: Report ID injection into directive ────────────────

section("Report ID injection into buildReportDirective");

{
  const { dir } = createTempProject();
  try {
    const rm = new ReportManager(dir);
    const template: ReportTemplate = {
      type: "daily_briefing",
      title: "CEO Daily Briefing",
      description: "Test",
      responsible_agent: "ceo",
      metrics: [],
      default_cron: "0 9 * * 1-5",
    };
    const metrics: ReportMetrics = {
      costs: { today_usd: 1.5, month_usd: 10.0, by_agent: [], history: [] },
      tasks: { total: 5, by_status: { done: 3, pending: 2 }, recently_completed: [] },
      reviews: [],
      journal: [],
    };

    const directive = rm.buildReportDirective(template, metrics, 42);
    assert(
      "Directive contains 'REPORT::COMPLETE id=42'",
      directive.includes("REPORT::COMPLETE id=42")
    );
    assert(
      "Directive does NOT contain literal '<report_id>'",
      !directive.includes("<report_id>")
    );

    const directive99 = rm.buildReportDirective(template, metrics, 99);
    assert(
      "Different ID (99) is injected correctly",
      directive99.includes("REPORT::COMPLETE id=99")
    );

    rm.close();
  } finally {
    cleanup(dir);
  }
}

// ── Fix 4: Honor include_cost_efficiency config ──────────────

section("computeReviewScores with/without efficiency");

{
  const metrics: AutoReviewMetrics = {
    taskCompletionCount: 8,
    taskAssignedCount: 10,
    avgTaskDurationMs: 60000,
    totalCostUsd: 5.0,
    costPerTask: 0.625,
    teamAvgCostPerTask: 1.0,
    reviewApprovalRate: 0.9,
    commentActivityCount: 15,
  };

  // With efficiency (default)
  const withEff = computeReviewScores(metrics);
  assert("taskScore = 80 (8/10 * 100)", withEff.taskScore === 80);
  assert("qualityScore = 90 (0.9 * 100)", withEff.qualityScore === 90);
  assert("efficiencyScore > 0 when included", withEff.efficiencyScore > 0);
  assert("collaborationScore = 75 (15/20 * 100)", withEff.collaborationScore === 75);

  // Without efficiency
  const withoutEff = computeReviewScores(metrics, false);
  assert("efficiencyScore = 0 when excluded", withoutEff.efficiencyScore === 0);
  assert("taskScore unchanged when efficiency excluded", withoutEff.taskScore === 80);
  assert("qualityScore unchanged when efficiency excluded", withoutEff.qualityScore === 90);

  // Verify weight redistribution produces different overall score
  const overallWith = Math.round(
    withEff.taskScore * 0.3 +
    withEff.qualityScore * 0.3 +
    withEff.efficiencyScore * 0.2 +
    withEff.collaborationScore * 0.2
  );
  const overallWithout = Math.round(
    withoutEff.taskScore * 0.375 +
    withoutEff.qualityScore * 0.375 +
    withoutEff.collaborationScore * 0.25
  );
  assert(
    `Overall WITH efficiency (${overallWith}) != WITHOUT (${overallWithout})`,
    overallWith !== overallWithout
  );
}

// ── Fix 5: Quality score SQL ─────────────────────────────────

section("Quality score query correctness");

{
  const { dir, dbPath } = createTempProject();
  try {
    const db = new Database(dbPath);

    // Insert test data: agent "dev" has review_result comments
    db.prepare(`INSERT INTO tasks (title, status, assigned_to, created_at, updated_at)
      VALUES ('Task 1', 'done', 'dev', datetime('now', '-5 days'), datetime('now', '-1 day'))`).run();

    db.prepare(`INSERT INTO tasks (title, status, assigned_to, created_at, updated_at)
      VALUES ('Task 2', 'done', 'dev', datetime('now', '-4 days'), datetime('now', '-2 days'))`).run();

    // review_result: approved
    db.prepare(`INSERT INTO task_comments (task_id, agent_role, comment_type, content, created_at)
      VALUES (1, 'dev', 'review_result', 'approved', datetime('now', '-1 day'))`).run();

    // review_result: approved with note
    db.prepare(`INSERT INTO task_comments (task_id, agent_role, comment_type, content, created_at)
      VALUES (2, 'dev', 'review_result', 'approved with minor suggestions', datetime('now', '-1 day'))`).run();

    // review_result: NOT approved (should NOT count as approved)
    db.prepare(`INSERT INTO task_comments (task_id, agent_role, comment_type, content, created_at)
      VALUES (2, 'dev', 'review_result', 'not approved - needs rework', datetime('now', '-1 day'))`).run();

    // General comment (should NOT count in denominator)
    db.prepare(`INSERT INTO task_comments (task_id, agent_role, comment_type, content, created_at)
      VALUES (1, 'dev', 'general', 'looks good overall', datetime('now', '-1 day'))`).run();

    // Cost entry so agent metrics don't all-zero
    db.prepare(`INSERT INTO cost_entries (agent_role, estimated_cost_usd, timestamp)
      VALUES ('dev', 0.5, datetime('now', '-1 day'))`).run();

    db.close();

    const metrics = collectAgentMetrics(dir, "dev", 30);

    // 3 review_result rows: 2 start with "approved", 1 starts with "not"
    // denominator = 3, numerator = 2, rate = 2/3 = 0.667
    assert(
      `reviewApprovalRate ~0.667 (got ${metrics.reviewApprovalRate.toFixed(3)})`,
      Math.abs(metrics.reviewApprovalRate - 2 / 3) < 0.01
    );
    assert(
      "General comments excluded from approval rate denominator",
      metrics.reviewApprovalRate > 0.5 // Would be 2/4=0.5 if general comments counted
    );
  } finally {
    cleanup(dir);
  }
}

// ── Fix 7: windowDays parameterization ───────────────────────

section("windowDays clamping and parameterization");

{
  const { dir } = createTempProject();
  try {
    // Test with extreme values — should not throw
    collectAgentMetrics(dir, "dev", 0); // clamped to 1
    assert("windowDays=0 does not throw (clamped to 1)", true);

    collectAgentMetrics(dir, "dev", 999); // clamped to 365
    assert("windowDays=999 does not throw (clamped to 365)", true);

    collectAgentMetrics(dir, "dev", 1.7); // floored to 1
    assert("windowDays=1.7 does not throw (floored to 1)", true);

    collectAgentMetrics(dir, "dev", -5); // clamped to 1
    assert("windowDays=-5 does not throw (clamped to 1)", true);
  } finally {
    cleanup(dir);
  }
}

// ── Fix 8: ReportManager works without ensureTables ──────────

section("ReportManager uses registerTable, no ensureTables");

{
  const { dir } = createTempProject();
  try {
    // Table already created by createTempProject helper (simulating registerTable)
    const rm = new ReportManager(dir);

    const report = rm.createReport({
      report_type: "daily_briefing",
      title: "Test Report",
      author_agent: "ceo",
    });
    assert("Report created successfully", report.id > 0);
    assert("Report has correct title", report.title === "Test Report");

    const fetched = rm.getReport(report.id);
    assert("Report retrievable after create", fetched !== null);

    rm.close();
  } finally {
    cleanup(dir);
  }
}

// ── Fix 10: listReports limit=0 behavior ─────────────────────

section("listReports limit=0");

{
  const { dir } = createTempProject();
  try {
    const rm = new ReportManager(dir);

    // Create 3 reports
    rm.createReport({ report_type: "daily_briefing", title: "R1" });
    rm.createReport({ report_type: "daily_briefing", title: "R2" });
    rm.createReport({ report_type: "daily_briefing", title: "R3" });

    const all = rm.listReports();
    assert(`3 reports exist (got ${all.length})`, all.length === 3);

    const limited = rm.listReports({ limit: 0 });
    assert(
      `limit=0 returns all (not treated as falsy) — got ${limited.length}`,
      limited.length === 3
    );

    const limited1 = rm.listReports({ limit: 1 });
    assert(`limit=1 returns 1 (got ${limited1.length})`, limited1.length === 1);

    rm.close();
  } finally {
    cleanup(dir);
  }
}

// ── Fix 2: Report content capture (unit-level) ──────────────

section("ReportManager.updateReport saves content");

{
  const { dir } = createTempProject();
  try {
    const rm = new ReportManager(dir);

    const report = rm.createReport({
      report_type: "daily_briefing",
      title: "Content Test",
    });
    assert("Initial content is empty", report.content === "");

    const updated = rm.updateReport(report.id, {
      status: "completed",
      completed_at: "2025-01-01 12:00:00",
      content: "This is the report body.",
    });
    assert("Updated report has content", updated?.content === "This is the report body.");
    assert("Status is completed", updated?.status === "completed");

    rm.close();
  } finally {
    cleanup(dir);
  }
}

// ── Fix 6: Atomic queue claim ────────────────────────────────

section("Atomic queue claim (no double-processing)");

{
  const { dir, dbPath } = createTempProject();
  try {
    const db = new Database(dbPath);

    // Insert 3 pending queue entries
    for (let i = 0; i < 3; i++) {
      db.prepare(
        "INSERT INTO auto_review_queue (agent_role, trigger_event, trigger_data) VALUES (?, ?, ?)"
      ).run(`dev-${i}`, "task_completed", "{}");
    }

    // Simulate the atomic claim pattern from processAutoReviewQueue
    const claimOne = db.transaction(() => {
      const entry = db
        .prepare("SELECT * FROM auto_review_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
        .get() as { id: number; agent_role: string } | undefined;
      if (!entry) return null;
      db.prepare("UPDATE auto_review_queue SET status = 'processing' WHERE id = ?").run(entry.id);
      return entry;
    });

    const claimed: number[] = [];
    let entry;
    while ((entry = claimOne()) !== null) {
      claimed.push(entry.id);
    }

    assert(`Claimed exactly 3 entries (got ${claimed.length})`, claimed.length === 3);
    assert(
      "All IDs are unique",
      new Set(claimed).size === claimed.length
    );

    // Verify no pending entries remain
    const remaining = db
      .prepare("SELECT COUNT(*) as count FROM auto_review_queue WHERE status = 'pending'")
      .get() as { count: number };
    assert("No pending entries remain", remaining.count === 0);

    db.close();
  } finally {
    cleanup(dir);
  }
}

// ── deriveRecommendation ─────────────────────────────────────

section("deriveRecommendation thresholds");

{
  assert("Score 90 -> promote", deriveRecommendation(90) === "promote");
  assert("Score 85 -> promote", deriveRecommendation(85) === "promote");
  assert("Score 84 -> maintain", deriveRecommendation(84) === "maintain");
  assert("Score 60 -> maintain", deriveRecommendation(60) === "maintain");
  assert("Score 59 -> improve", deriveRecommendation(59) === "improve");
  assert("Score 40 -> improve", deriveRecommendation(40) === "improve");
  assert("Score 39 -> demote", deriveRecommendation(39) === "demote");
  assert("Score 0 -> demote", deriveRecommendation(0) === "demote");
}

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));

if (failed > 0) {
  console.log("\n  SOME TESTS FAILED — review output above.\n");
  process.exit(1);
} else {
  console.log("\n  ALL TESTS PASSED\n");
  process.exit(0);
}
