import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PersonaOverlay, AgentPersonaConfig } from "./persona.js";
import { applyPresetToContent } from "./persona.js";
import { applyPersonaStudio } from "./persona-studio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Package root: dist/core/ -> package root (two levels up)
// Templates live in src/templates/ relative to package root
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "src", "templates");
const STRUCTURES_DIR = path.join(TEMPLATES_DIR, "structures");
const INDUSTRIES_DIR = path.join(TEMPLATES_DIR, "industries");
const SHARED_PRESETS_DIR = path.join(TEMPLATES_DIR, "presets");

export interface AgentFrontmatter {
  role: string;
  title: string;
  model: string;
  reports_to: string;
  department: string;
  spawns: string[];
  tools: string[];
  escalation_threshold: string;
  check_in_interval?: string;
  // Agent intelligence fields (Phase 2 Wave 2 Session 3)
  autonomy_level?: string;
  skills?: string[];
  // Reserved for Phase 3 — will be used as default priority when recording escalation events
  escalation_priority?: string;
}

export interface AgentDefinition {
  frontmatter: AgentFrontmatter;
  content: string;
  filePath: string;
}

export function parseAgentFile(filePath: string): AgentDefinition {
  const raw = fs.readFileSync(filePath, "utf-8");
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(`Invalid agent file format: ${filePath}. Expected YAML frontmatter.`);
  }

  const frontmatterRaw = frontmatterMatch[1];
  const content = frontmatterMatch[2].trim();

  // Simple YAML frontmatter parser (avoids circular dep with js-yaml import patterns)
  const frontmatter: Record<string, unknown> = {};
  let currentKey = "";
  let inArray = false;
  const arrayItems: string[] = [];

  for (const line of frontmatterRaw.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("- ") && inArray) {
      arrayItems.push(trimmed.slice(2).trim());
      continue;
    }

    if (inArray) {
      frontmatter[currentKey] = [...arrayItems];
      arrayItems.length = 0;
      inArray = false;
    }

    const kvMatch = trimmed.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "" || value === "[]") {
        // Could be an empty array or start of array block
        if (value === "[]") {
          frontmatter[key] = [];
        } else {
          currentKey = key;
          inArray = true;
        }
      } else {
        // Scalar value
        if (value === "true") frontmatter[key] = true;
        else if (value === "false") frontmatter[key] = false;
        else if (/^\d+$/.test(value)) frontmatter[key] = parseInt(value, 10);
        else frontmatter[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  if (inArray) {
    frontmatter[currentKey] = [...arrayItems];
  }

  return {
    frontmatter: frontmatter as unknown as AgentFrontmatter,
    content,
    filePath,
  };
}

export function loadAgentDefinitions(
  agentsDir: string,
  preset?: PersonaOverlay,
  overrides?: Map<string, PersonaOverlay>,
  agentPersonas?: Record<string, AgentPersonaConfig>,
  templateDir?: string
): Map<string, AgentDefinition> {
  const agents = new Map<string, AgentDefinition>();

  if (!fs.existsSync(agentsDir)) {
    return agents;
  }

  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const filePath = path.join(agentsDir, file);
    const agent = parseAgentFile(filePath);

    // Apply per-agent override if it exists, otherwise apply the global preset
    const agentOverride = overrides?.get(agent.frontmatter.role);
    const effectivePreset = agentOverride || preset;

    if (effectivePreset) {
      agent.content = applyPresetToContent(agent.content, effectivePreset);
    }

    // Apply Agent Persona Studio layers if configured
    const personaConfig = agentPersonas?.[agent.frontmatter.role];
    if (personaConfig && templateDir) {
      agent.content = applyPersonaStudio(
        agent.content,
        agent.frontmatter.role,
        personaConfig,
        templateDir
      );
    }

    agents.set(agent.frontmatter.role, agent);
  }

  return agents;
}

export function getTemplateAgentsDir(templateName: string): string {
  return path.join(TEMPLATES_DIR, templateName, "agents");
}

export function getTemplatePath(templateName: string): string {
  return path.join(TEMPLATES_DIR, templateName);
}

export function listTemplates(): string[] {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return [];
  }
  return fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => {
      const dirPath = path.join(TEMPLATES_DIR, d.name);
      return (
        fs.existsSync(path.join(dirPath, "config.yaml")) &&
        fs.existsSync(path.join(dirPath, "agents"))
      );
    })
    .map((d) => d.name);
}

export function getStructuresDir(): string {
  return STRUCTURES_DIR;
}

export function getIndustriesDir(): string {
  return INDUSTRIES_DIR;
}

export function getSharedPresetsDir(): string {
  return SHARED_PRESETS_DIR;
}

export function renderAgentContent(
  content: string,
  variables: Record<string, string>
): string {
  let rendered = content;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return rendered;
}
