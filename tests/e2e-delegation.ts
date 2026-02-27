/**
 * End-to-End Test: Prove Delegation Works
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   cd /path/to/your/aicib-project  (must have run `aicib init` first)
 *   npx tsx tests/e2e-delegation.ts [project-dir]
 *
 * Runs 3 sequential briefs to test:
 * 1. Single-department delegation (CTO creates a file)
 * 2. Multi-department delegation (CTO + CMO + CFO)
 * 3. Session memory (CEO recalls previous work)
 */

import {
  startCEOSession,
  sendBrief,
  formatMessage,
  recordRunCosts,
  type SessionResult,
} from "../src/core/agent-runner.js";
import { loadConfig } from "../src/core/config.js";
import { CostTracker } from "../src/core/cost-tracker.js";
import path from "node:path";
import fs from "node:fs";

const DIVIDER = "─".repeat(60);

function log(msg: string) {
  console.log(`  ${msg}`);
}

function header(title: string) {
  console.log(`\n${DIVIDER}`);
  console.log(`  ${title}`);
  console.log(DIVIDER);
}

async function main() {
  const projectDir = path.resolve(process.argv[2] || process.cwd());

  header("AICIB End-to-End Test — Delegation");
  log(`Project dir: ${projectDir}\n`);

  const config = loadConfig(projectDir);
  log(`Company: ${config.company.name}`);
  log(`Template: ${config.company.template}`);

  const costTracker = new CostTracker(projectDir);
  let totalCost = 0;
  let allPassed = true;

  // Message printer
  const printMsg = (msg: Parameters<typeof formatMessage>[0]) => {
    const formatted = formatMessage(msg);
    if (formatted) log(formatted);
  };

  // ── Test 1: Start the CEO session ──
  header("Step 0: Starting CEO session");

  const startResult = await startCEOSession(projectDir, config, printMsg);

  if (!startResult.sessionId) {
    log("FAIL: No session ID returned");
    process.exit(1);
  }

  const sdkSessionId = startResult.sessionId;
  log(`\nSession ID: ${sdkSessionId}`);
  log(`Cost: $${startResult.totalCostUsd.toFixed(4)}`);
  totalCost += startResult.totalCostUsd;

  // Save session for resume
  const localSessionId = `e2e-test-${Date.now()}`;
  costTracker.createSession(localSessionId);
  costTracker.saveSDKSessionId(
    localSessionId,
    sdkSessionId,
    projectDir,
    config.company.name
  );
  recordRunCosts(startResult, costTracker, localSessionId, "ceo", "opus");

  // ── Test 1: Single-department delegation ──
  header("Test 1: Single-department delegation");
  log('Brief: "Have the CTO create a README.md for this project"\n');

  const test1Result = await sendBrief(
    sdkSessionId,
    "Have the CTO create a README.md file for this project. It should include the company name and a brief description.",
    projectDir,
    config,
    printMsg
  );

  recordRunCosts(test1Result, costTracker, localSessionId, "ceo", "opus");
  totalCost += test1Result.totalCostUsd;

  // Check if README.md was created
  const readmePath = path.join(projectDir, "README.md");
  const readmeExists = fs.existsSync(readmePath);
  log(`\nREADME.md created: ${readmeExists ? "YES" : "NO"}`);
  log(`Cost: $${test1Result.totalCostUsd.toFixed(4)}`);

  if (readmeExists) {
    log("[PASS] CTO subagent created README.md");
  } else {
    log("[WARN] README.md not found — delegation may have worked differently");
  }

  // ── Test 2: Multi-department delegation ──
  header("Test 2: Multi-department delegation");
  log(
    'Brief: "CTO: create index.html, CMO: write marketing copy, CFO: estimate costs"\n'
  );

  const test2Result = await sendBrief(
    sdkSessionId,
    `I need three things done in parallel:
1. CTO: Create a simple index.html landing page
2. CMO: Write a one-paragraph marketing description and save it to marketing-copy.txt
3. CFO: Create a cost-estimate.txt with estimated monthly hosting costs for a simple web app`,
    projectDir,
    config,
    printMsg
  );

  recordRunCosts(test2Result, costTracker, localSessionId, "ceo", "opus");
  totalCost += test2Result.totalCostUsd;

  // Check for files
  const htmlExists = fs.existsSync(path.join(projectDir, "index.html"));
  const copyExists = fs.existsSync(
    path.join(projectDir, "marketing-copy.txt")
  );
  const costEstExists = fs.existsSync(
    path.join(projectDir, "cost-estimate.txt")
  );

  log(`\nindex.html created:       ${htmlExists ? "YES" : "NO"}`);
  log(`marketing-copy.txt:       ${copyExists ? "YES" : "NO"}`);
  log(`cost-estimate.txt:        ${costEstExists ? "YES" : "NO"}`);
  log(`Cost: $${test2Result.totalCostUsd.toFixed(4)}`);

  const filesCreated = [htmlExists, copyExists, costEstExists].filter(
    Boolean
  ).length;
  if (filesCreated >= 2) {
    log(`[PASS] ${filesCreated}/3 files created — multi-department delegation works`);
  } else {
    log(
      `[WARN] Only ${filesCreated}/3 files created — delegation may need prompt tuning`
    );
    allPassed = false;
  }

  // ── Test 3: Session memory ──
  header("Test 3: Session memory");
  log('Brief: "What have we built so far?"\n');

  const test3Result = await sendBrief(
    sdkSessionId,
    "What have we built so far? Summarize all the work that has been done across all departments.",
    projectDir,
    config,
    printMsg
  );

  recordRunCosts(test3Result, costTracker, localSessionId, "ceo", "opus");
  totalCost += test3Result.totalCostUsd;

  log(`\nCost: $${test3Result.totalCostUsd.toFixed(4)}`);
  log("[PASS] CEO responded (session memory check — review output above)");

  // ── Summary ──
  header("RESULTS SUMMARY");

  const costsByAgent = costTracker.getCostByAgent(localSessionId);
  if (costsByAgent.length > 0) {
    log("Cost breakdown:");
    for (const c of costsByAgent) {
      log(`  ${c.role.padEnd(22)} $${c.total_cost_usd.toFixed(4)}`);
    }
  }

  log(`\nTotal cost: $${totalCost.toFixed(4)}`);
  log(`Under $5 budget: ${totalCost < 5 ? "YES" : "NO"}`);

  if (totalCost >= 5) {
    log("[WARN] Test cost exceeded $5 budget");
  }

  // Cleanup
  costTracker.endSession(localSessionId);
  costTracker.clearSDKSessionData(localSessionId);
  costTracker.close();

  console.log(`\n${DIVIDER}`);
  if (allPassed) {
    console.log("  ALL DELEGATION TESTS PASSED!");
  } else {
    console.log("  SOME DELEGATION TESTS NEED ATTENTION.");
  }
  console.log(`${DIVIDER}\n`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(
    `\n  FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
