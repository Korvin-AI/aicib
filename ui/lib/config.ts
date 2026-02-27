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
