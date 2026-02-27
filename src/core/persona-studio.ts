import fs from "node:fs";
import path from "node:path";
import type {
  AgentPersonaConfig,
  PersonalityTraits,
  AgentBackground,
  RolePreset,
} from "./persona.js";

// --- Trait Descriptions ---
// Each trait dimension+value maps to a 1-2 sentence behavioral instruction.

const COMMUNICATION_DESCRIPTIONS: Record<string, string> = {
  direct:
    "You communicate directly and concisely. Get to the point quickly, avoid hedging language, and state your position clearly.",
  diplomatic:
    "You communicate diplomatically. Frame feedback constructively, acknowledge multiple perspectives, and soften strong opinions with inclusive language.",
  analytical:
    "You communicate in an analytical style. Lead with data and evidence, structure arguments logically, and qualify claims with supporting reasoning.",
  creative:
    "You communicate creatively. Use vivid metaphors, storytelling, and unconventional framing to make points memorable and engaging.",
};

const DECISION_DESCRIPTIONS: Record<string, string> = {
  "data-driven":
    "You make decisions based on data and evidence. Request metrics before committing to a direction, and prefer quantifiable outcomes over intuition.",
  intuitive:
    "You trust your instincts in decision-making. Draw on pattern recognition and experience, and move quickly when the direction feels right.",
  collaborative:
    "You prefer collaborative decision-making. Seek input from stakeholders, build consensus, and ensure buy-in before moving forward.",
};

const RISK_DESCRIPTIONS: Record<string, string> = {
  conservative:
    "You take a conservative approach to risk. Favor proven approaches, require thorough analysis before committing resources, and prioritize stability.",
  moderate:
    "You take a balanced approach to risk. Willing to experiment within bounds, but always with a fallback plan and clear success criteria.",
  aggressive:
    "You embrace bold risks. Push for ambitious targets, accept that some bets won't pay off, and prioritize speed and upside over safety.",
};

const ASSERTIVENESS_DESCRIPTIONS: Record<number, string> = {
  1: "You are highly deferential. Present suggestions tentatively and defer to others' judgment in most situations.",
  2: "You are somewhat reserved. Share your views when asked but avoid pushing back strongly on disagreements.",
  3: "You are moderately assertive. State your position clearly while remaining open to other viewpoints.",
  4: "You are quite assertive. Advocate strongly for your position and push back confidently when you disagree.",
  5: "You are extremely assertive. Take charge of discussions, defend your position vigorously, and don't back down easily.",
};

const CREATIVITY_DESCRIPTIONS: Record<number, string> = {
  1: "You prefer conventional, proven approaches. Stick to established best practices and avoid novel experimentation.",
  2: "You lean toward established methods but occasionally suggest incremental improvements.",
  3: "You balance creativity with pragmatism. Introduce fresh ideas while respecting what already works.",
  4: "You actively seek creative solutions. Regularly propose novel approaches and challenge conventional thinking.",
  5: "You are highly creative and unconventional. Constantly push boundaries, propose radical ideas, and think far outside the box.",
};

const CONFLICT_DESCRIPTIONS: Record<string, string> = {
  confrontational:
    "When conflicts arise, you address them head-on. Name the disagreement directly, push for resolution, and don't shy away from difficult conversations.",
  collaborative:
    "When conflicts arise, you seek collaborative resolution. Look for win-win outcomes, mediate between positions, and work to preserve relationships.",
  avoidant:
    "When conflicts arise, you prefer to de-escalate. Redirect to common ground, table contentious issues, and avoid direct confrontation.",
};

// --- Role Preset Loading ---

/**
 * Loads a role-specific preset from the template directory.
 * Expects files at `<templateDir>/presets/roles/<role>/<presetName>.md`.
 */
export function loadRolePreset(
  templateDir: string,
  role: string,
  presetName: string
): RolePreset {
  const filePath = path.join(
    templateDir,
    "presets",
    "roles",
    role,
    `${presetName}.md`
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Role preset "${presetName}" for role "${role}" not found at ${filePath}`
    );
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(
      `Invalid role preset file format: ${filePath}. Expected YAML frontmatter.`
    );
  }

  const frontmatterRaw = frontmatterMatch[1];
  const content = frontmatterMatch[2].trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatterRaw.split("\n")) {
    const kvMatch = line.trim().match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (kvMatch) {
      meta[kvMatch[1]] = kvMatch[2].trim().replace(/^["']|["']$/g, "");
    }
  }

  return {
    name: meta.name || presetName,
    displayName: meta.display_name || presetName,
    description: meta.description || "",
    role,
    content,
  };
}

/**
 * Lists available role presets for a given role by scanning the directory.
 */
export function listRolePresets(
  templateDir: string,
  role: string
): RolePreset[] {
  const presetsDir = path.join(templateDir, "presets", "roles", role);

  if (!fs.existsSync(presetsDir)) {
    return [];
  }

  const files = fs.readdirSync(presetsDir).filter((f) => f.endsWith(".md"));
  const presets: RolePreset[] = [];

  for (const file of files) {
    const presetName = file.replace(".md", "");
    try {
      presets.push(loadRolePreset(templateDir, role, presetName));
    } catch (err) {
      console.warn(
        `Warning: Skipping invalid preset "${presetName}" for role "${role}": ${(err as Error).message}`
      );
    }
  }

  return presets;
}

// --- Trait Compilation ---

/**
 * Converts structured personality traits into natural-language markdown
 * behavioral instructions. Deterministic — no LLM needed.
 */
export function compileTraits(traits: PersonalityTraits): string {
  const lines: string[] = [];

  if (traits.communication_style && COMMUNICATION_DESCRIPTIONS[traits.communication_style]) {
    lines.push(COMMUNICATION_DESCRIPTIONS[traits.communication_style]);
  }
  if (traits.decision_making && DECISION_DESCRIPTIONS[traits.decision_making]) {
    lines.push(DECISION_DESCRIPTIONS[traits.decision_making]);
  }
  if (traits.risk_tolerance && RISK_DESCRIPTIONS[traits.risk_tolerance]) {
    lines.push(RISK_DESCRIPTIONS[traits.risk_tolerance]);
  }
  if (traits.assertiveness !== undefined && ASSERTIVENESS_DESCRIPTIONS[traits.assertiveness]) {
    lines.push(ASSERTIVENESS_DESCRIPTIONS[traits.assertiveness]);
  }
  if (traits.creativity !== undefined && CREATIVITY_DESCRIPTIONS[traits.creativity]) {
    lines.push(CREATIVITY_DESCRIPTIONS[traits.creativity]);
  }
  if (traits.conflict_approach && CONFLICT_DESCRIPTIONS[traits.conflict_approach]) {
    lines.push(CONFLICT_DESCRIPTIONS[traits.conflict_approach]);
  }

  return lines.join("\n\n");
}

// --- Background Compilation ---

/**
 * Formats agent background fields into readable markdown.
 */
export function compileBackground(background: AgentBackground): string {
  const lines: string[] = [];

  if (background.years_experience !== undefined) {
    lines.push(
      `You have **${background.years_experience} years** of professional experience.`
    );
  }
  if (background.industry_experience && background.industry_experience.length > 0) {
    lines.push(
      `Your industry experience spans: ${background.industry_experience.join(", ")}.`
    );
  }
  if (background.specialized_knowledge && background.specialized_knowledge.length > 0) {
    lines.push(
      `Your areas of specialized knowledge include: ${background.specialized_knowledge.join(", ")}.`
    );
  }
  if (background.work_history) {
    lines.push(`**Career summary:** ${background.work_history}`);
  }

  return lines.join("\n\n");
}

// --- Display Name ---

/**
 * Modifies the first top-level heading to include the display name.
 * e.g., "# Chief Executive Officer (CEO)" → "# Sarah — Chief Executive Officer (CEO)"
 */
export function applyDisplayName(
  content: string,
  displayName: string
): string {
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("# "));
  if (idx !== -1) {
    lines[idx] = `# ${displayName} — ${lines[idx].slice(2)}`;
  }
  return lines.join("\n");
}

// --- Main Orchestrator ---

/**
 * Applies all Agent Persona Studio layers to an agent's content in order:
 * 1. Role-specific preset content
 * 2. Compiled personality traits
 * 3. Background context
 * 4. Display name (heading modification)
 */
export function applyPersonaStudio(
  agentContent: string,
  role: string,
  agentPersona: AgentPersonaConfig,
  templateDir: string
): string {
  let content = agentContent;

  // Layer 1: Role-specific preset
  if (agentPersona.role_preset) {
    try {
      const rolePreset = loadRolePreset(
        templateDir,
        role,
        agentPersona.role_preset
      );
      if (rolePreset.content) {
        content += `\n\n## Role Archetype (${rolePreset.displayName})\n\n${rolePreset.content}`;
      }
    } catch (err) {
      console.warn(
        `Warning: Could not load role preset "${agentPersona.role_preset}" for ${role}: ${(err as Error).message}`
      );
    }
  }

  // Layer 2: Personality traits
  if (agentPersona.traits) {
    const traitsContent = compileTraits(agentPersona.traits);
    if (traitsContent) {
      content += `\n\n## Personality Calibration\n\n${traitsContent}`;
    }
  }

  // Layer 3: Background context
  if (agentPersona.background) {
    const bgContent = compileBackground(agentPersona.background);
    if (bgContent) {
      content += `\n\n## Professional Background\n\n${bgContent}`;
    }
  }

  // Layer 4: Display name (modifies heading, must come last)
  if (agentPersona.display_name) {
    content = applyDisplayName(content, agentPersona.display_name);
  }

  return content;
}
