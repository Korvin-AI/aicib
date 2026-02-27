/**
 * Agent Skills System (#3)
 *
 * Defines structured capabilities that agents can have. Each skill bundles:
 * prompt guidance + required tools + knowledge domains. 14 built-in skills
 * cover engineering, finance, marketing, and cross-functional domains.
 *
 * Integration: Context provider injects abbreviated skill descriptions into
 * the CEO's prompt for better delegation. Config extension allows custom
 * skill definitions and per-agent overrides.
 */

// --- Types ---

/** A skill definition: what an agent needs to perform a specific capability. */
export interface SkillDefinition {
  name: string;
  description: string;
  prompt_template: string;
  required_tools: string[];
  knowledge_domains: string[];
  typical_roles: string[];
}

/** A custom skill defined in config. */
export interface CustomSkillConfig {
  description: string;
  prompt_template: string;
  required_tools?: string[];
  knowledge_domains?: string[];
}

/** The skills config section in aicib.config.yaml. */
export interface SkillsConfig {
  enabled: boolean;
  custom: Record<string, CustomSkillConfig>;
  overrides: Record<string, { add?: string[]; remove?: string[] }>;
}

// --- Built-in Skills Library ---

const BUILT_IN_SKILLS: Record<string, SkillDefinition> = {
  // --- Engineering Skills ---
  code_review: {
    name: "code_review",
    description: "Review code for quality, security, and adherence to standards",
    prompt_template: `When reviewing code, evaluate:
- Correctness: Does it do what it's supposed to?
- Security: Are there vulnerabilities (SQL injection, XSS, auth bypass)?
- Performance: Any obvious bottlenecks or N+1 queries?
- Readability: Can another developer understand this in 30 seconds?
- Standards: Does it follow the project's coding conventions?
Provide specific line-level feedback with severity (critical/warning/suggestion).`,
    required_tools: ["Read", "Grep", "Glob"],
    knowledge_domains: ["typescript", "security", "best_practices"],
    typical_roles: ["cto", "backend-engineer", "frontend-engineer"],
  },

  architecture_design: {
    name: "architecture_design",
    description: "Design system architecture with tradeoff analysis",
    prompt_template: `When designing architecture:
- Always present at least 2 alternatives with tradeoffs
- Consider: scalability, maintainability, cost, complexity, time-to-implement
- Use diagrams (ASCII or Mermaid) when describing system interactions
- Tag complexity: "quick win" (~hours), "~1 day", "~3 days", ">3 days (needs decomposition)"
- End with explicit "Rejected alternatives" section explaining why they were rejected`,
    required_tools: ["Read", "Write", "Glob", "Grep"],
    knowledge_domains: ["system_design", "cloud_infrastructure", "databases"],
    typical_roles: ["cto"],
  },

  api_development: {
    name: "api_development",
    description: "Design and implement REST/GraphQL APIs",
    prompt_template: `When building APIs:
- Design the contract first (endpoints, request/response shapes, error codes)
- Use RESTful conventions (proper HTTP methods, status codes, resource naming)
- Validate all inputs at the boundary
- Include error handling with meaningful error messages
- Document with OpenAPI/Swagger where applicable`,
    required_tools: ["Read", "Write", "Edit", "Bash"],
    knowledge_domains: ["api_design", "http", "validation"],
    typical_roles: ["backend-engineer"],
  },

  frontend_development: {
    name: "frontend_development",
    description: "Build accessible, responsive user interfaces",
    prompt_template: `When building frontend components:
- Mobile-first responsive design
- Semantic HTML (not div soup)
- Accessibility: ARIA labels, keyboard navigation, color contrast
- Component hierarchy: describe the tree (Parent > Child > Grandchild)
- Follow existing component patterns in the project`,
    required_tools: ["Read", "Write", "Edit", "Bash"],
    knowledge_domains: ["ui_design", "accessibility", "css", "react"],
    typical_roles: ["frontend-engineer"],
  },

  testing: {
    name: "testing",
    description: "Write and run tests (unit, integration, e2e)",
    prompt_template: `When testing:
- Cover happy path, edge cases, and error cases
- Use descriptive test names: "should [expected behavior] when [condition]"
- Test behavior, not implementation details
- Mock external dependencies, not internal functions
- Aim for meaningful coverage, not 100% metric gaming`,
    required_tools: ["Read", "Write", "Edit", "Bash"],
    knowledge_domains: ["testing", "mocking", "assertions"],
    typical_roles: ["backend-engineer", "frontend-engineer"],
  },

  // --- Finance Skills ---
  financial_modeling: {
    name: "financial_modeling",
    description: "Build financial models with scenario analysis",
    prompt_template: `When building financial models:
- Start with napkin math to validate the general direction
- Always present 3 scenarios: best-case, expected, worst-case
- Use tables for all multi-variable data
- Flag any assumption that could swing the result by >20%
- End every analysis with "Bottom Line:" one-liner
- Show your methodology so results can be verified`,
    required_tools: ["Read", "Write", "WebSearch"],
    knowledge_domains: ["finance", "unit_economics", "pricing"],
    typical_roles: ["cfo", "financial-analyst"],
  },

  market_analysis: {
    name: "market_analysis",
    description: "Analyze market size, competition, and positioning",
    prompt_template: `When analyzing markets:
- Use both top-down and bottom-up approaches to triangulate
- Present data in tables, not paragraphs
- Cite sources for all external data
- Include competitive landscape with feature/pricing matrices
- End with "Assumptions" and "Caveats" sections`,
    required_tools: ["Read", "Write", "WebSearch", "WebFetch"],
    knowledge_domains: ["market_research", "competitive_analysis"],
    typical_roles: ["cfo", "financial-analyst", "cmo"],
  },

  budget_tracking: {
    name: "budget_tracking",
    description: "Track and report on budgets, spending, and forecasts",
    prompt_template: `When tracking budgets:
- Compare actuals to plan and highlight variances
- Use red/yellow/green indicators for budget health
- Present burn rate and runway projections
- Flag overspend risks before they happen
- Recommend cost optimization opportunities`,
    required_tools: ["Read", "Write"],
    knowledge_domains: ["finance", "budgeting"],
    typical_roles: ["cfo", "financial-analyst"],
  },

  // --- Marketing Skills ---
  content_strategy: {
    name: "content_strategy",
    description:
      "Plan content that drives awareness, acquisition, and retention",
    prompt_template: `When planning content:
- Define the audience and their pain points first
- Map every piece to a funnel stage: awareness > consideration > conversion > retention
- Specify distribution channels for each piece
- Include SEO strategy: target keywords, search intent
- Frame everything in terms of the user's journey`,
    required_tools: ["Read", "Write", "WebSearch"],
    knowledge_domains: ["marketing", "seo", "content_marketing"],
    typical_roles: ["cmo"],
  },

  copywriting: {
    name: "copywriting",
    description: "Write persuasive, on-brand copy for any medium",
    prompt_template: `When writing copy:
- Hook first — the first sentence determines if anyone reads the second
- Clear over clever — never sacrifice clarity for wit
- Active voice, short sentences, concrete examples
- Always provide 3 headline alternatives
- End with a clear CTA
- No jargon without explanation, no buzzwords ever`,
    required_tools: ["Read", "Write", "Edit"],
    knowledge_domains: ["copywriting", "brand_voice", "persuasion"],
    typical_roles: ["content-writer", "cmo"],
  },

  seo_optimization: {
    name: "seo_optimization",
    description: "Optimize content for search engine visibility",
    prompt_template: `When optimizing for SEO:
- Research target keywords and search intent
- Structure content with proper H1/H2/H3 hierarchy
- Include meta title (<60 chars) and meta description (<160 chars)
- Natural keyword placement (no stuffing)
- Internal linking strategy`,
    required_tools: ["Read", "Write", "Edit", "WebSearch"],
    knowledge_domains: ["seo", "content_marketing"],
    typical_roles: ["content-writer", "cmo"],
  },

  // --- Cross-functional Skills ---
  project_planning: {
    name: "project_planning",
    description: "Break down projects into phased, actionable plans",
    prompt_template: `When planning projects:
- Start with the end goal and work backward
- Break into phases with clear milestones
- Identify dependencies and critical path
- Assign ownership for each work item
- Include risk assessment and contingency plans
- Rate confidence 1-5 on timeline estimates`,
    required_tools: ["Read", "Write", "TodoWrite"],
    knowledge_domains: ["project_management", "planning"],
    typical_roles: ["ceo", "cto"],
  },

  stakeholder_reporting: {
    name: "stakeholder_reporting",
    description: "Create executive summaries and status reports",
    prompt_template: `When reporting to stakeholders:
- Lead with the key takeaway, not background
- Use executive summary format: decision/action first, then context
- Keep status updates scannable with bullet points
- Always include: progress, blockers, decisions needed, next steps
- Include cost/timeline data when relevant`,
    required_tools: ["Read", "Write"],
    knowledge_domains: ["communication", "executive_reporting"],
    typical_roles: ["ceo"],
  },

  research: {
    name: "research",
    description: "Conduct web research and synthesize findings",
    prompt_template: `When researching:
- Define the research question clearly before searching
- Use multiple sources and cross-reference
- Distinguish facts from opinions
- Present findings in structured format with citations
- Include confidence level on conclusions`,
    required_tools: ["WebSearch", "WebFetch", "Read", "Write"],
    knowledge_domains: ["research_methodology"],
    typical_roles: ["financial-analyst", "content-writer", "cmo"],
  },
};

// --- Default Role → Skills Mapping ---

const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
  ceo: ["project_planning", "stakeholder_reporting"],
  cto: ["architecture_design", "code_review", "project_planning"],
  cfo: ["financial_modeling", "market_analysis", "budget_tracking"],
  cmo: ["content_strategy", "copywriting", "market_analysis"],
  "backend-engineer": ["api_development", "code_review", "testing"],
  "frontend-engineer": ["frontend_development", "code_review", "testing"],
  "financial-analyst": ["financial_modeling", "market_analysis", "research"],
  "content-writer": ["copywriting", "seo_optimization", "research"],
};

// --- Functions ---

/**
 * Resolve skill names to full SkillDefinition objects.
 * Checks built-in library first, then custom skills from config.
 */
export function resolveSkills(
  skillNames: string[],
  config: SkillsConfig
): SkillDefinition[] {
  const resolved: SkillDefinition[] = [];

  for (const name of skillNames) {
    if (BUILT_IN_SKILLS[name]) {
      resolved.push(BUILT_IN_SKILLS[name]);
      continue;
    }
    if (config.custom?.[name]) {
      const custom = config.custom[name];
      resolved.push({
        name,
        description: custom.description,
        prompt_template: custom.prompt_template,
        required_tools: custom.required_tools || [],
        knowledge_domains: custom.knowledge_domains || [],
        typical_roles: [],
      });
      continue;
    }
    console.warn(
      `  Warning: Unknown skill "${name}" — skipping. Add it as a custom skill in config or check the name.`
    );
  }

  return resolved;
}

/**
 * Resolve the effective skill list for an agent.
 * If frontmatter has skills (even empty), use them. Otherwise use role defaults.
 * Config overrides (add/remove) are applied on top.
 */
export function resolveAgentSkills(
  agentRole: string,
  frontmatterSkills: string[] | string | undefined,
  config: SkillsConfig
): string[] {
  // frontmatter undefined → use defaults. frontmatter [] → respect empty.
  // Scalar string (from YAML parser) → wrap in array.
  let skills: string[];
  if (frontmatterSkills === undefined) {
    skills = [...(DEFAULT_ROLE_SKILLS[agentRole] || [])];
  } else if (Array.isArray(frontmatterSkills)) {
    skills = [...frontmatterSkills];
  } else {
    // Scalar string from YAML parser — wrap in array
    skills = [frontmatterSkills];
  }

  const override = config.overrides?.[agentRole];
  if (override) {
    if (override.add) {
      for (const skill of override.add) {
        if (!skills.includes(skill)) {
          skills.push(skill);
        }
      }
    }
    if (override.remove) {
      const toRemove = override.remove;
      skills = skills.filter((s) => !toRemove.includes(s));
    }
  }

  return skills;
}

/**
 * Format skills as markdown for prompt injection.
 * Returns abbreviated descriptions for the CEO overview.
 */
export function formatSkillsContext(
  _agentRole: string,
  skills: SkillDefinition[]
): string {
  if (skills.length === 0) return "";

  let output = "";
  for (const skill of skills) {
    const heading = skill.name
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    output += `- **${heading}**: ${skill.description}\n`;
  }

  return output;
}

/** List all available built-in skill names. */
export function listBuiltInSkills(): string[] {
  return Object.keys(BUILT_IN_SKILLS);
}

/** Get a built-in skill by name. */
export function getBuiltInSkill(name: string): SkillDefinition | undefined {
  return BUILT_IN_SKILLS[name];
}

/** Get default skills for a role. Returns a copy to prevent mutation. */
export function getDefaultSkills(role: string): string[] {
  return [...(DEFAULT_ROLE_SKILLS[role] || [])];
}

// --- Config Extension ---

export const SKILLS_CONFIG_DEFAULTS: SkillsConfig = {
  enabled: true,
  custom: {},
  overrides: {},
};

export function validateSkillsConfig(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw !== undefined && (typeof raw !== "object" || raw === null)) {
    errors.push("skills must be an object (not a scalar)");
    return errors;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    if (obj.enabled !== undefined && typeof obj.enabled !== "boolean") {
      errors.push("skills.enabled must be a boolean");
    }

    if (
      obj.custom !== undefined &&
      typeof obj.custom === "object" &&
      obj.custom !== null
    ) {
      for (const [name, def] of Object.entries(
        obj.custom as Record<string, unknown>
      )) {
        if (def && typeof def === "object") {
          const d = def as Record<string, unknown>;
          if (!d.description || typeof d.description !== "string") {
            errors.push(
              `skills.custom.${name}.description must be a non-empty string`
            );
          }
          if (!d.prompt_template || typeof d.prompt_template !== "string") {
            errors.push(
              `skills.custom.${name}.prompt_template must be a non-empty string`
            );
          }
        } else {
          errors.push(
            `skills.custom.${name} must be an object with description and prompt_template`
          );
        }
      }
    }

    if (
      obj.overrides !== undefined &&
      typeof obj.overrides === "object" &&
      obj.overrides !== null
    ) {
      for (const [role, override] of Object.entries(
        obj.overrides as Record<string, unknown>
      )) {
        if (override && typeof override === "object") {
          const o = override as Record<string, unknown>;
          if (o.add !== undefined) {
            if (!Array.isArray(o.add)) {
              errors.push(`skills.overrides.${role}.add must be an array`);
            } else if (o.add.some((x: unknown) => typeof x !== "string")) {
              errors.push(`skills.overrides.${role}.add items must be strings`);
            }
          }
          if (o.remove !== undefined) {
            if (!Array.isArray(o.remove)) {
              errors.push(`skills.overrides.${role}.remove must be an array`);
            } else if (o.remove.some((x: unknown) => typeof x !== "string")) {
              errors.push(`skills.overrides.${role}.remove items must be strings`);
            }
          }
        }
      }
    }
  }
  return errors;
}
