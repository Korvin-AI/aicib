import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface CloudCredentials {
  apiKey: string;
  email: string;
  orgId: string;
  orgSlug: string;
  apiUrl: string;
}

const CREDENTIALS_DIR = path.join(os.homedir(), ".aicib");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "cloud-credentials.json");

export function loadCloudCredentials(): CloudCredentials | null {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const raw = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as CloudCredentials;
  } catch {
    return null;
  }
}

export function saveCloudCredentials(creds: CloudCredentials): void {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function clearCloudCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // File may not exist
  }
}
