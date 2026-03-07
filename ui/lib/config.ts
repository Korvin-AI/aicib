import fs from "node:fs";
import path from "node:path";
import { tryGetActiveProjectDir } from "./business-context";

/**
 * Detect the AICIB project directory.
 * 1. Check AICIB_PROJECT_DIR env var (set by `aicib ui` command)
 * 2. Fallback: walk up from cwd() looking for aicib.config.yaml
 */
export function getProjectDir(): string {
  const projectDir = tryGetActiveProjectDir();
  if (projectDir) return projectDir;
  throw new Error("No active business selected. Create or import a business first.");
}

/**
 * Like getProjectDir() but returns null instead of throwing.
 * When AICIB_PROJECT_DIR is set (e.g. by `aicib ui`), returns that directory
 * even if config doesn't exist yet — the wizard needs to know WHERE to create it.
 */
export function tryGetProjectDir(): string | null {
  return tryGetActiveProjectDir();
}

/**
 * Path to the local aicib CLI binary.
 * The UI runs from aicib/ui/, so the CLI is at ../dist/index.js.
 * Throws a clear error if the binary hasn't been built yet.
 */
export function getAicibBin(): string {
  const bin = path.resolve(process.cwd(), "..", "dist", "index.js");
  if (!fs.existsSync(bin)) {
    throw new Error(
      `CLI binary not found at ${bin}. Run "npm run build" in the aicib/ directory first.`
    );
  }
  return bin;
}
