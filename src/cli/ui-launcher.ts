import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function uiCommand(options: {
  dir: string;
  port: string;
}): Promise<void> {
  const projectDir = path.resolve(options.dir);
  const port = options.port;

  // Resolve ui/ directory relative to the compiled dist/ output
  // __dirname is dist/cli/, so ui/ is at ../../ui/ from there
  const uiDir = path.resolve(__dirname, "../../ui");

  if (!fs.existsSync(uiDir)) {
    console.error(
      `UI directory not found at ${uiDir}. Ensure the project is set up correctly.`
    );
    process.exit(1);
  }

  // Auto-install dependencies if needed
  const nodeModules = path.join(uiDir, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    console.log("Installing UI dependencies (first run)...");
    const install = spawn("npm", ["install"], {
      cwd: uiDir,
      stdio: "inherit",
    });

    await new Promise<void>((resolve, reject) => {
      install.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install failed with code ${code}`));
      });
    });
  }

  console.log(`Starting AICIB Dashboard on port ${port}...`);

  // Spawn Next.js dev server
  const nextDev = spawn("npx", ["next", "dev", "--port", port], {
    cwd: uiDir,
    stdio: "inherit",
    env: {
      ...process.env,
      AICIB_PROJECT_DIR: projectDir,
    },
  });

  // Open browser after a short delay
  setTimeout(() => {
    const url = `http://localhost:${port}`;
    console.log(`Opening ${url} in your browser...`);
    spawn("open", [url], { stdio: "ignore" });
  }, 2000);

  // Forward signals for clean shutdown
  const cleanup = () => {
    nextDev.kill("SIGTERM");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for process to exit
  nextDev.on("close", (code) => {
    process.exit(code ?? 0);
  });
}
