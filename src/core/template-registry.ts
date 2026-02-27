import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { getStructuresDir, getIndustriesDir } from "./agents.js";

// --- Types ---

export interface RoleDefinition {
  title: string;
  model: string;
  reports_to: string;
  department: string;
  spawns: string[];
  tools: string[];
  escalation_threshold: string;
  check_in_interval?: string;
  autonomy_level?: string;
  skills?: string[];
  escalation_priority?: string;
}

export interface StructureDefinition {
  name: string;
  display_name: string;
  description: string;
  agent_count: number;
  roles: Record<string, RoleDefinition>;
  config_template: {
    agents: Record<string, unknown>;
  };
}

export interface IndustryManifest {
  name: string;
  display_name: string;
  description: string;
  recommended_structure?: string;
  recommended_preset?: string;
  industry_knowledge: string[];
}

export interface ResolvedTemplate {
  structure: string;
  industry: string;
}

// --- Template alias map ---

const TEMPLATE_ALIASES: Record<string, ResolvedTemplate> = {
  "saas-startup": { structure: "full-c-suite", industry: "saas-startup" },
};

// --- Functions ---

/**
 * Returns the user templates directory (~/.aicib/templates/), or null if HOME is not set.
 */
function getUserTemplatesDir(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return null;
  return path.join(home, ".aicib", "templates");
}

/**
 * Lists available structure names by scanning the package structures/ directory
 * and user-installed templates that contain a structure.yaml.
 */
export function listStructures(): string[] {
  const names = new Set<string>();

  // Package structures
  const dir = getStructuresDir();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".yaml")) {
        names.add(f.replace(".yaml", ""));
      }
    }
  }

  // User-installed templates that include a structure.yaml
  const userDir = getUserTemplatesDir();
  if (userDir && fs.existsSync(userDir)) {
    for (const entry of fs.readdirSync(userDir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        fs.existsSync(path.join(userDir, entry.name, "structure.yaml"))
      ) {
        names.add(entry.name);
      }
    }
  }

  return [...names];
}

/**
 * Lists available industry names by scanning the package industries/ directory
 * and user-installed templates that contain an industry/ subdirectory.
 * Excludes the _shared directory.
 */
export function listIndustries(): string[] {
  const names = new Set<string>();

  // Package industries
  const dir = getIndustriesDir();
  if (fs.existsSync(dir)) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory() && d.name !== "_shared") {
        names.add(d.name);
      }
    }
  }

  // User-installed templates that include an industry/ subdirectory
  const userDir = getUserTemplatesDir();
  if (userDir && fs.existsSync(userDir)) {
    for (const entry of fs.readdirSync(userDir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        fs.existsSync(path.join(userDir, entry.name, "industry"))
      ) {
        names.add(entry.name);
      }
    }
  }

  return [...names];
}

/**
 * Loads and parses a structure YAML definition.
 */
export function getStructure(name: string): StructureDefinition {
  // Check package structures first
  const filePath = path.join(getStructuresDir(), `${name}.yaml`);
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf-8");
    return yaml.load(raw) as StructureDefinition;
  }

  // Check user-installed templates
  const userDir = getUserTemplatesDir();
  if (userDir) {
    const userPath = path.join(userDir, name, "structure.yaml");
    if (fs.existsSync(userPath)) {
      const raw = fs.readFileSync(userPath, "utf-8");
      return yaml.load(raw) as StructureDefinition;
    }
  }

  throw new Error(
    `Structure "${name}" not found. Available: ${listStructures().join(", ")}`
  );
}

/**
 * Loads and parses an industry manifest.yaml.
 */
export function getIndustry(name: string): IndustryManifest {
  // Check package industries first
  const manifestPath = path.join(getIndustriesDir(), name, "manifest.yaml");
  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return yaml.load(raw) as IndustryManifest;
  }

  // Check user-installed templates
  const userDir = getUserTemplatesDir();
  if (userDir) {
    const userManifestPath = path.join(userDir, name, "industry", "manifest.yaml");
    if (fs.existsSync(userManifestPath)) {
      const raw = fs.readFileSync(userManifestPath, "utf-8");
      return yaml.load(raw) as IndustryManifest;
    }
  }

  throw new Error(
    `Industry "${name}" not found. Available: ${listIndustries().join(", ")}`
  );
}

/**
 * Returns the directory path for an industry's agent files.
 */
export function getIndustryAgentsDir(name: string): string {
  // Check package industries first
  const packageDir = path.join(getIndustriesDir(), name, "agents");
  if (fs.existsSync(packageDir)) {
    return packageDir;
  }

  // Check user-installed templates
  const userDir = getUserTemplatesDir();
  if (userDir) {
    const userAgentsDir = path.join(userDir, name, "industry", "agents");
    if (fs.existsSync(userAgentsDir)) {
      return userAgentsDir;
    }
  }

  return packageDir; // fallback to package path (may not exist)
}

/**
 * Returns the directory path for the _shared fallback agents.
 */
export function getSharedAgentsDir(): string {
  return path.join(getIndustriesDir(), "_shared", "agents");
}

/**
 * Resolves a template name, which may be:
 * - A legacy alias (e.g., "saas-startup" → { structure: "full-c-suite", industry: "saas-startup" })
 * - A structure name (returns with no industry, caller must prompt)
 * - null if not recognized
 */
export function resolveTemplate(name: string): ResolvedTemplate | null {
  if (TEMPLATE_ALIASES[name]) {
    return { ...TEMPLATE_ALIASES[name] };
  }

  // Check if it's a structure name
  const structures = listStructures();
  if (structures.includes(name)) {
    return { structure: name, industry: "" };
  }

  return null;
}

/**
 * Validates that a structure + industry combination is valid.
 * Returns an array of error messages (empty = valid).
 */
export function validateCombination(
  structureName: string,
  industryName: string
): string[] {
  const errors: string[] = [];

  const structures = listStructures();
  if (!structures.includes(structureName)) {
    errors.push(
      `Unknown structure "${structureName}". Available: ${structures.join(", ")}`
    );
  }

  const industries = listIndustries();
  if (!industries.includes(industryName)) {
    errors.push(
      `Unknown industry "${industryName}". Available: ${industries.join(", ")}`
    );
  }

  return errors;
}

/**
 * Returns display info for all structures (for interactive prompts).
 */
export function getStructureChoices(): Array<{
  name: string;
  value: string;
  description: string;
  agent_count: number;
}> {
  return listStructures().map((name) => {
    const structure = getStructure(name);
    return {
      name: `${structure.display_name} — ${structure.description}`,
      value: name,
      description: structure.description,
      agent_count: structure.agent_count,
    };
  });
}

/**
 * Returns display info for all industries (for interactive prompts).
 */
export function getIndustryChoices(): Array<{
  name: string;
  value: string;
  description: string;
}> {
  return listIndustries().map((name) => {
    const industry = getIndustry(name);
    return {
      name: `${industry.display_name} — ${industry.description}`,
      value: name,
      description: industry.description,
    };
  });
}
