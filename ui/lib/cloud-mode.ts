/**
 * Cloud mode detection utilities.
 *
 * NEXT_PUBLIC_CLOUD_MODE — "true" for cloud SaaS, absent for local self-hosted.
 * CLOUD_API_URL           — Hono server URL (server-only, never exposed to browser).
 */

export function isCloudMode(): boolean {
  return process.env.NEXT_PUBLIC_CLOUD_MODE === "true";
}

export function getCloudApiUrl(): string {
  const url = process.env.CLOUD_API_URL;
  if (!url && isCloudMode()) {
    throw new Error("CLOUD_API_URL is required in cloud mode");
  }
  return url || "http://localhost:3001";
}
