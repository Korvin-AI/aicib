import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  getStructure,
  getIndustry,
  getIndustryAgentsDir,
  getSharedAgentsDir,
  type StructureDefinition,
  type RoleDefinition,
} from "./template-registry.js";
import { renderAgentContent } from "./agents.js";
import { getSharedPresetsDir } from "./agents.js";

// --- Types ---

export interface ComposedAgent {
  fileName: string;
  content: string;
}

export interface ComposedTemplate {
  configYaml: string;
  agentFiles: ComposedAgent[];
}

// --- Functions ---

/**
 * Composes a complete template from a structure + industry combination.
 * For each role in the structure:
 *   - Frontmatter comes from the structure definition
 *   - Body comes from the industry's agents/{role}.md
 *   - Falls back to _shared/agents/{role}.md if industry doesn't cover the role
 * Returns the config YAML and all composed agent files.
 */
export function composeTemplate(
  structureName: string,
  industryName: string,
  companyName: string,
  preset: string
): ComposedTemplate {
  const structure = getStructure(structureName);
  const industry = getIndustry(industryName);
  const industryAgentsDir = getIndustryAgentsDir(industryName);
  const sharedAgentsDir = getSharedAgentsDir();

  const agentFiles: ComposedAgent[] = [];

  for (const [roleName, roleDefinition] of Object.entries(structure.roles)) {
    const body = loadAgentBody(roleName, industryAgentsDir, sharedAgentsDir);
    const frontmatter = buildFrontmatter(roleName, roleDefinition);
    const rawContent = `---\n${frontmatter}---\n\n${body}`;
    const rendered = renderAgentContent(rawContent, {
      company_name: companyName,
    });

    agentFiles.push({
      fileName: `${roleName}.md`,
      content: rendered,
    });
  }

  const configYaml = buildConfigYaml(
    structure,
    companyName,
    industryName,
    preset
  );

  return { configYaml, agentFiles };
}

/**
 * Loads the body content for a role from the industry or shared directory.
 */
function loadAgentBody(
  roleName: string,
  industryAgentsDir: string,
  sharedAgentsDir: string
): string {
  // Try industry-specific first
  const industryPath = path.join(industryAgentsDir, `${roleName}.md`);
  if (fs.existsSync(industryPath)) {
    return fs.readFileSync(industryPath, "utf-8").trim();
  }

  // Fall back to _shared
  const sharedPath = path.join(sharedAgentsDir, `${roleName}.md`);
  if (fs.existsSync(sharedPath)) {
    return fs.readFileSync(sharedPath, "utf-8").trim();
  }

  // If neither exists, generate a minimal body
  const roleTitle =
    roleName
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  return `# ${roleTitle}

You are the ${roleTitle} at {{company_name}}.

## Your Role

You handle ${roleTitle.toLowerCase()} responsibilities for the company.

## How You Think

- Focus on delivering results within your domain
- Coordinate with your team and leadership

## Inner Monologue

*Here's how I approach a task:*

> "Let me understand what's needed, plan my approach, and deliver."

## Decision Authority

### You decide autonomously:
- Day-to-day decisions within your domain

### Escalate to your manager:
- Decisions that affect other departments
- Anything outside your expertise

## Communication Style

- Clear and direct
- Lead with the key point

## Key Phrases

- "Here's what I recommend..."

## Behavioral Quirks

- Always provides a summary of work completed

## Communication Protocol

- Report progress to your manager
- Coordinate with peers as needed

## Working Style

- Understand requirements before starting
- Deliver complete, tested work

## Signature Moves

- **Thorough delivery**: Always delivers complete work with context

## Sample Deliverable Snippet

\`\`\`
## Task Complete

**What was done:** [Summary]
**Files changed:** [List]
**Next steps:** [Recommendations]
\`\`\``;
}

/**
 * Builds YAML frontmatter string from a role definition.
 */
function buildFrontmatter(
  roleName: string,
  role: RoleDefinition
): string {
  const lines: string[] = [];

  lines.push(`role: ${roleName}`);
  lines.push(`title: ${role.title}`);
  lines.push(`model: ${role.model}`);
  lines.push(`reports_to: ${role.reports_to}`);
  lines.push(`department: ${role.department}`);

  // spawns
  if (role.spawns.length === 0) {
    lines.push("spawns: []");
  } else {
    lines.push("spawns:");
    for (const s of role.spawns) {
      lines.push(`  - ${s}`);
    }
  }

  // tools
  lines.push("tools:");
  for (const t of role.tools) {
    lines.push(`  - ${t}`);
  }

  lines.push(`escalation_threshold: ${role.escalation_threshold}`);

  if (role.check_in_interval) {
    lines.push(`check_in_interval: "${role.check_in_interval}"`);
  }

  if (role.autonomy_level) {
    lines.push(`autonomy_level: ${role.autonomy_level}`);
  }

  if (role.skills && role.skills.length > 0) {
    lines.push("skills:");
    for (const s of role.skills) {
      lines.push(`  - ${s}`);
    }
  }

  if (role.escalation_priority) {
    lines.push(`escalation_priority: ${role.escalation_priority}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Builds the aicib.config.yaml content for the composed template.
 */
function buildConfigYaml(
  structure: StructureDefinition,
  companyName: string,
  industryName: string,
  preset: string
): string {
  const config = {
    company: {
      name: companyName,
      template: `${structure.name}+${industryName}`,
    },
    agents: structure.config_template.agents,
    persona: {
      preset,
    },
    settings: {
      cost_limit_daily: 50,
      cost_limit_monthly: 500,
      escalation_threshold: "high",
      auto_start_workers: true,
    },
  };

  return yaml.dump(config, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

/**
 * Gets the list of agent roles that would be produced by a structure.
 */
export function getComposedRoles(structureName: string): string[] {
  const structure = getStructure(structureName);
  return Object.keys(structure.roles);
}

/**
 * Lists available agent body files for a given industry (including _shared).
 */
export function listIndustryAgents(industryName: string): string[] {
  const industryAgentsDir = getIndustryAgentsDir(industryName);
  const agents: string[] = [];

  if (fs.existsSync(industryAgentsDir)) {
    const files = fs.readdirSync(industryAgentsDir).filter((f) =>
      f.endsWith(".md")
    );
    agents.push(...files.map((f) => f.replace(".md", "")));
  }

  return agents;
}
