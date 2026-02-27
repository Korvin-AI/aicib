/**
 * Core initialization placeholder.
 * The UI reads directly from SQLite and does not import core modules,
 * so no side-effect registration is needed. Kept for potential future use.
 */
export function ensureCoreInit(): void {
  // No-op: UI uses direct SQLite queries instead of importing core modules.
  // This avoids Turbopack issues with .js extension resolution in core source files.
}
