import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// --- Types ---

export interface TemplatePackage {
  name: string;
  version: string;
  author: string;
  description: string;
  structure?: string;
  industry?: string;
}

// --- Functions ---

/**
 * Validates that a template name contains only lowercase letters, numbers, and hyphens.
 * Prevents path traversal attacks via crafted template names.
 */
function sanitizeTemplateName(name: string): string {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!sanitized || sanitized !== name) {
    throw new Error(
      `Invalid template name "${name}". Only lowercase letters, numbers, and hyphens are allowed.`
    );
  }
  return sanitized;
}

/**
 * Exports the current project as a shareable template directory.
 * Extracts the agent definitions and config into a portable format.
 */
export function exportTemplate(
  projectDir: string,
  outputPath: string
): void {
  const agentsDir = path.join(projectDir, ".claude", "agents");
  const configPath = path.join(projectDir, "aicib.config.yaml");

  if (!fs.existsSync(agentsDir)) {
    throw new Error(
      "No agent definitions found. Run 'aicib init' first."
    );
  }
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "No aicib.config.yaml found. Run 'aicib init' first."
    );
  }

  // Create output directory structure
  const industryDir = path.join(outputPath, "industry", "agents");
  fs.mkdirSync(industryDir, { recursive: true });

  // Read config to extract metadata
  const configRaw = fs.readFileSync(configPath, "utf-8");
  const config = yaml.load(configRaw) as Record<string, unknown>;
  const company = config.company as Record<string, string>;

  // Create template.yaml manifest
  const templateManifest: TemplatePackage = {
    name: company.name
      ? company.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
      : "my-template",
    version: "1.0.0",
    author: "",
    description: `Template exported from ${company.name || "project"}`,
    structure: undefined,
    industry: undefined,
  };

  // Parse the template field if it exists (format: "structure+industry")
  const templateField = company.template || "";
  if (templateField.includes("+")) {
    const [structure, industry] = templateField.split("+");
    templateManifest.structure = structure;
    templateManifest.industry = industry;
  }

  fs.writeFileSync(
    path.join(outputPath, "template.yaml"),
    yaml.dump(templateManifest, { lineWidth: -1 }),
    "utf-8"
  );

  // Copy agent files, stripping frontmatter into body-only format
  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  for (const file of agentFiles) {
    const raw = fs.readFileSync(path.join(agentsDir, file), "utf-8");
    const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    const body = match ? match[1].trim() : raw.trim();

    // Replace any hardcoded company name back to placeholder
    const companyName = company.name || "";
    let bodyWithPlaceholder = body;
    if (companyName) {
      bodyWithPlaceholder = body.replace(
        new RegExp(escapeRegex(companyName), "g"),
        "{{company_name}}"
      );
    }

    fs.writeFileSync(path.join(industryDir, file), bodyWithPlaceholder, "utf-8");
  }

  // Create a basic industry manifest
  const industryManifest = {
    name: templateManifest.name,
    display_name: company.name || "Custom Template",
    description: templateManifest.description,
    industry_knowledge: [] as string[],
  };

  fs.writeFileSync(
    path.join(outputPath, "industry", "manifest.yaml"),
    yaml.dump(industryManifest, { lineWidth: -1 }),
    "utf-8"
  );

  // Copy presets if they exist
  const presetsDir = path.join(projectDir, ".aicib", "presets");
  if (fs.existsSync(presetsDir)) {
    const outputPresetsDir = path.join(outputPath, "presets");
    fs.mkdirSync(outputPresetsDir, { recursive: true });
    const presetFiles = fs.readdirSync(presetsDir).filter((f) =>
      f.endsWith(".md")
    );
    for (const file of presetFiles) {
      fs.copyFileSync(
        path.join(presetsDir, file),
        path.join(outputPresetsDir, file)
      );
    }
  }
}

/**
 * Imports a community template into ~/.aicib/templates/.
 */
export function importTemplate(sourcePath: string): string {
  const errors = validateTemplatePackage(sourcePath);
  if (errors.length > 0) {
    throw new Error(
      `Invalid template package:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }

  // Read template name
  const templateYamlPath = path.join(sourcePath, "template.yaml");
  const raw = fs.readFileSync(templateYamlPath, "utf-8");
  const pkg = yaml.load(raw) as TemplatePackage;

  // Validate template name to prevent path traversal
  sanitizeTemplateName(pkg.name);

  // Install to user templates directory
  const userTemplatesDir = getUserTemplatesDir();
  const destDir = path.join(userTemplatesDir, pkg.name);

  // Copy entire template directory
  copyDirRecursive(sourcePath, destDir);

  return pkg.name;
}

/**
 * Validates a template package directory structure.
 * Returns an array of error messages (empty = valid).
 */
export function validateTemplatePackage(dirPath: string): string[] {
  const errors: string[] = [];

  if (!fs.existsSync(dirPath)) {
    errors.push(`Directory does not exist: ${dirPath}`);
    return errors;
  }

  // Must have template.yaml
  const templateYamlPath = path.join(dirPath, "template.yaml");
  if (!fs.existsSync(templateYamlPath)) {
    errors.push("Missing template.yaml");
  } else {
    try {
      const raw = fs.readFileSync(templateYamlPath, "utf-8");
      const pkg = yaml.load(raw) as Record<string, unknown>;
      if (!pkg.name) errors.push("template.yaml missing 'name' field");
      if (!pkg.version) errors.push("template.yaml missing 'version' field");
    } catch (e) {
      errors.push(
        `template.yaml is not valid YAML: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Must have either industry/ or structure.yaml (or both)
  const hasIndustry = fs.existsSync(path.join(dirPath, "industry"));
  const hasStructure = fs.existsSync(path.join(dirPath, "structure.yaml"));

  if (!hasIndustry && !hasStructure) {
    errors.push(
      "Template must include either an industry/ directory or structure.yaml (or both)"
    );
  }

  // If industry/ exists, check for manifest.yaml and agents/
  if (hasIndustry) {
    const industryDir = path.join(dirPath, "industry");
    if (!fs.existsSync(path.join(industryDir, "manifest.yaml"))) {
      errors.push("industry/ directory missing manifest.yaml");
    }
    const agentsDir = path.join(industryDir, "agents");
    if (!fs.existsSync(agentsDir)) {
      errors.push("industry/ directory missing agents/ subdirectory");
    } else {
      const agentFiles = fs
        .readdirSync(agentsDir)
        .filter((f) => f.endsWith(".md"));
      if (agentFiles.length === 0) {
        errors.push("industry/agents/ contains no .md files");
      }
    }
  }

  return errors;
}

// --- Helpers ---

function getUserTemplatesDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  const dir = path.join(home, ".aicib", "templates");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
