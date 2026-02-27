/**
 * Smoke test: Can We Talk to Claude?
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   cd /path/to/your/aicib-project  (must have run `aicib init` first)
 *   npx tsx tests/smoke-basic.ts [project-dir]
 *
 * Verifies:
 * - SDK installs and loads
 * - CEO session starts and responds
 * - Session ID is returned
 * - Cost data is present
 */

import { startCEOSession, formatMessage } from "../src/core/agent-runner.js";
import { loadConfig } from "../src/core/config.js";
import path from "node:path";

async function main() {
  const projectDir = path.resolve(process.argv[2] || process.cwd());

  console.log("=".repeat(60));
  console.log("  AICIB Smoke Test — Basic");
  console.log("=".repeat(60));
  console.log(`\n  Project dir: ${projectDir}\n`);

  // Load config
  let config;
  try {
    config = loadConfig(projectDir);
    console.log(`  Company: ${config.company.name}`);
    console.log(`  Template: ${config.company.template}\n`);
  } catch (err) {
    console.error(
      `  ERROR: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error("  Run 'aicib init --name TestCo' first.\n");
    process.exit(1);
  }

  console.log("-".repeat(60));
  console.log("  Starting CEO session...\n");

  const result = await startCEOSession(projectDir, config, (msg) => {
    const formatted = formatMessage(msg);
    if (formatted) {
      console.log(`  ${formatted}`);
    }
  });

  console.log("\n" + "-".repeat(60));
  console.log("  Results:\n");
  console.log(`  Session ID:   ${result.sessionId}`);
  console.log(`  Total cost:   $${result.totalCostUsd.toFixed(4)}`);
  console.log(
    `  Tokens:       ${result.inputTokens} in / ${result.outputTokens} out`
  );
  console.log(`  Turns:        ${result.numTurns}`);
  console.log(`  Duration:     ${(result.durationMs / 1000).toFixed(1)}s`);

  // Verification checks
  console.log("\n" + "-".repeat(60));
  console.log("  Verification:\n");

  let allPassed = true;

  if (result.sessionId) {
    console.log("  [PASS] Session ID returned");
  } else {
    console.log("  [FAIL] No session ID returned");
    allPassed = false;
  }

  if (result.totalCostUsd > 0) {
    console.log("  [PASS] Cost data present");
  } else {
    console.log("  [WARN] Cost data is zero (may be cached or free tier)");
  }

  if (result.numTurns > 0) {
    console.log("  [PASS] CEO responded (turns > 0)");
  } else {
    console.log("  [FAIL] No response from CEO");
    allPassed = false;
  }

  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("  ALL CHECKS PASSED!");
  } else {
    console.log("  SOME CHECKS FAILED.");
  }
  console.log("=".repeat(60) + "\n");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n  FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
