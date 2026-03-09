import { loadCloudCredentials, type CloudCredentials } from "./cloud-credentials.js";

export const DEFAULT_CLOUD_URL = "https://app.aicib.io";

export class CloudClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(creds?: CloudCredentials) {
    const resolved = creds ?? loadCloudCredentials();
    if (!resolved) {
      throw new Error(
        'Not authenticated. Run `aicib cloud signup` first.',
      );
    }
    this.apiUrl = resolved.apiUrl || process.env.AICIB_CLOUD_URL || DEFAULT_CLOUD_URL;
    this.apiKey = resolved.apiKey;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          "Authentication failed. Run `aicib cloud signup` to re-authenticate.",
        );
      }
      if (res.status === 403) {
        throw new Error(
          "Permission denied. Check your account permissions.",
        );
      }
      const errBody = await res.text();
      throw new Error(`Cloud API error (${res.status}): ${errBody}`);
    }

    return (await res.json()) as T;
  }

  async upload(path: string, buffer: Buffer): Promise<void> {
    const url = `${this.apiUrl}${path}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Upload failed (${res.status}): ${errBody}`);
    }
  }
}
