import chalk from "chalk";
import inquirer from "inquirer";
import { loadConfig, saveConfig, listAllAgents } from "../core/config.js";
import {
  loadCloudCredentials,
  saveCloudCredentials,
} from "../core/cloud-credentials.js";
import { CloudClient, DEFAULT_CLOUD_URL } from "../core/cloud-client.js";

// ---------------------------------------------------------------------------
// aicib cloud signup — Interactive admin signup
// ---------------------------------------------------------------------------

export async function cloudSignupCommand(): Promise<void> {
  const apiUrl = process.env.AICIB_CLOUD_URL || DEFAULT_CLOUD_URL;
  console.log(chalk.bold("\nAICIB Cloud Signup (Admin)\n"));
  console.log(`Cloud URL: ${apiUrl}\n`);

  const { email, password, displayName } = await inquirer.prompt([
    {
      type: "input",
      name: "email",
      message: "Email:",
      validate: (v: string) => (v.includes("@") ? true : "Enter a valid email"),
    },
    {
      type: "password",
      name: "password",
      message: "Password (min 8 chars):",
      mask: "*",
      validate: (v: string) =>
        v.length >= 8 ? true : "Password must be at least 8 characters",
    },
    {
      type: "input",
      name: "displayName",
      message: "Display name (optional):",
    },
  ]);

  // 1. Sign up
  console.log("\nCreating account...");
  const signupRes = await fetch(`${apiUrl}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      ...(displayName ? { displayName } : {}),
    }),
  });

  if (!signupRes.ok) {
    const body = await signupRes.json().catch(() => ({ error: "Unknown error" }));
    console.error(chalk.red(`Signup failed: ${(body as any).error || signupRes.statusText}`));
    process.exit(1);
  }

  const signupData = (await signupRes.json()) as {
    user: { id: string; email: string };
    org: { id: string; slug: string };
  };

  // Extract session cookie from response (Node 19.7+ getSetCookie)
  const cookies = signupRes.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.startsWith("aicib_session="));
  const sessionToken = sessionCookie?.match(/aicib_session=([^;]+)/)?.[1];

  if (!sessionToken) {
    console.error(chalk.red("Failed to extract session from signup response."));
    process.exit(1);
  }

  // 2. Generate API key
  console.log("Generating API key...");
  const apiKeyRes = await fetch(`${apiUrl}/auth/api-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `aicib_session=${sessionToken}`,
    },
    body: JSON.stringify({ name: "cli" }),
  });

  if (!apiKeyRes.ok) {
    const body = await apiKeyRes.json().catch(() => ({ error: "Unknown error" }));
    console.error(chalk.red(`API key generation failed: ${(body as any).error || apiKeyRes.statusText}`));
    process.exit(1);
  }

  const { apiKey } = (await apiKeyRes.json()) as { apiKey: string };

  // 3. Save credentials
  saveCloudCredentials({
    apiKey,
    email,
    orgId: signupData.org.id,
    orgSlug: signupData.org.slug,
    apiUrl,
  });

  console.log(chalk.green("\nCloud account created and credentials saved."));
  console.log(`  Email: ${email}`);
  console.log(`  Org:   ${signupData.org.slug}`);
  console.log(`  Creds: ~/.aicib/cloud-credentials.json\n`);
}

// ---------------------------------------------------------------------------
// aicib cloud link — Link local project to cloud business
// ---------------------------------------------------------------------------

export async function cloudLinkCommand(opts: { dir: string; force?: boolean }): Promise<void> {
  const dir = opts.dir || process.cwd();
  const config = loadConfig(dir);

  // Idempotency guard: prevent duplicate business creation
  if (config.cloud?.businessId && !opts.force) {
    console.log(chalk.yellow(`\nProject already linked to cloud business: ${config.cloud.businessId}`));
    console.log("Use --force to re-link.\n");
    return;
  }

  const creds = loadCloudCredentials();
  if (!creds) {
    console.error(chalk.red("Not authenticated. Run `aicib cloud signup` first."));
    process.exit(1);
  }

  const client = new CloudClient(creds);

  console.log(chalk.bold("\nLinking project to AICIB Cloud\n"));

  // 1. Create business
  console.log(`Creating cloud business for "${config.company.name}"...`);
  const response = await client.request<{ success: boolean; business: { id: string; name: string } }>(
    "POST",
    "/businesses",
    {
      name: config.company.name,
      template: config.company.template,
    },
  );
  const business = response.business;

  // TODO: sync agent definitions when server endpoint exists

  // 2. Save link to local config
  config.cloud = {
    businessId: business.id,
    linkedAt: new Date().toISOString(),
  };
  saveConfig(dir, config);

  console.log(chalk.green("\nProject linked to cloud."));
  console.log(`  Business ID: ${business.id}`);
  console.log(`  Business:    ${business.name}\n`);
}
