import { loadAgentDefinitions } from "./agents.js";
import { getAgentsDir } from "./team.js";
import type { AicibConfig } from "./config.js";
import { getAgentColor } from "./output-formatter.js";

export interface OrgNode {
  role: string;
  title: string;
  children: OrgNode[];
}

/**
 * Reads agent definitions and builds a tree from reports_to and spawns fields.
 * Root is always CEO. Children are C-suite heads filtered by config.enabled.
 * Grandchildren are workers from spawns arrays.
 */
export function buildOrgTree(projectDir: string, config: AicibConfig): OrgNode {
  const agentsDir = getAgentsDir(projectDir);
  // Metadata only — persona overlay not needed
  const agents = loadAgentDefinitions(agentsDir);

  const ceoAgent = agents.get("ceo");
  const root: OrgNode = {
    role: "ceo",
    title: ceoAgent?.frontmatter.title || "Chief Executive Officer",
    children: [],
  };

  // Collect C-suite heads (reports_to === "ceo") that are enabled
  for (const [role, agent] of agents) {
    if (agent.frontmatter.reports_to !== "ceo") continue;

    const agentConfig = config.agents[role];
    if (agentConfig && agentConfig.enabled === false) continue;

    const headNode: OrgNode = {
      role,
      title: agent.frontmatter.title,
      children: [],
    };

    // Add workers from spawns array
    if (agent.frontmatter.spawns) {
      for (const workerRole of agent.frontmatter.spawns) {
        const workerAgent = agents.get(workerRole);
        // Check if worker is enabled in config
        let workerEnabled = true;
        if (agentConfig?.workers) {
          for (const workerEntry of agentConfig.workers) {
            if (workerRole in workerEntry && workerEntry[workerRole].enabled === false) {
              workerEnabled = false;
            }
          }
        }
        if (workerEnabled) {
          headNode.children.push({
            role: workerRole,
            title: workerAgent?.frontmatter.title || workerRole,
            children: [],
          });
        }
      }
    }

    root.children.push(headNode);
  }

  return root;
}

/**
 * Abbreviates a role name for compact display under department heads.
 */
function abbreviateRole(role: string): string {
  const abbrevs: Record<string, string> = {
    "backend-engineer": "BE",
    "frontend-engineer": "FE",
    "financial-analyst": "FA",
    "content-writer": "CW",
    "data-scientist": "DS",
    "qa-engineer": "QA",
    "devops-engineer": "DO",
    "product-manager": "PM",
  };
  return abbrevs[role] || role.slice(0, 2).toUpperCase();
}

/**
 * Renders an org chart as a multi-line string with unicode box-drawing characters.
 * Each node is colored according to its agent role.
 */
export function renderOrgChart(tree: OrgNode): string {
  const lines: string[] = [];
  const ceoColor = getAgentColor("ceo");

  // CEO box at top
  const ceoLabel = `  ${tree.title} (${tree.role.toUpperCase()})  `;
  const boxWidth = ceoLabel.length + 2;
  const topBorder = `┌${"─".repeat(boxWidth)}┐`;
  const bottomBorder = `└${"─".repeat(Math.floor(boxWidth / 2))}┬${"─".repeat(Math.ceil(boxWidth / 2))}┘`;
  const content = `│ ${ceoLabel} │`;

  // Center the CEO box
  lines.push(ceoColor(topBorder));
  lines.push(ceoColor(content));
  lines.push(ceoColor(bottomBorder));

  if (tree.children.length === 0) return lines.join("\n");

  // Build department head boxes
  const headBoxes: string[][] = [];
  const headWidths: number[] = [];

  for (const head of tree.children) {
    const color = getAgentColor(head.role);
    const label = head.role.toUpperCase();
    const w = label.length + 4; // padding inside box
    headWidths.push(w);

    const box: string[] = [];
    box.push(color(`┌${"─".repeat(w)}┐`));
    box.push(color(`│ ${label.padEnd(w - 1)}│`));
    box.push(color(`└${"─".repeat(Math.floor(w / 2))}┬${"─".repeat(Math.ceil(w / 2))}┘`));
    headBoxes.push(box);
  }

  // Build branching line from CEO to department heads
  const gap = 4; // space between boxes
  // Center the branching connector
  const ceoCenter = Math.floor(boxWidth / 2) + 1;

  // Compute center positions of each head box
  const headCenters: number[] = [];
  let offset = 0;
  for (let i = 0; i < tree.children.length; i++) {
    const boxW = headWidths[i] + 2; // +2 for box borders
    headCenters.push(offset + Math.floor(boxW / 2));
    offset += boxW + gap;
  }

  // Draw connector line
  const firstCenter = headCenters[0];
  const lastCenter = headCenters[headCenters.length - 1];
  const connectorWidth = lastCenter - firstCenter + 1;
  const connectorChars: string[] = new Array(connectorWidth).fill("─");

  // Place branch points
  for (const center of headCenters) {
    const pos = center - firstCenter;
    if (pos === 0 || pos === connectorWidth - 1) {
      connectorChars[pos] = pos === 0 ? "┌" : "┐";
    } else {
      connectorChars[pos] = "┬";
    }
  }

  const leftPad = " ".repeat(Math.max(0, ceoCenter - firstCenter - 1));
  lines.push(`${leftPad}${connectorChars.join("")}`);

  // Draw head boxes side by side
  for (let row = 0; row < 3; row++) {
    let line = "";
    for (let i = 0; i < headBoxes.length; i++) {
      if (i > 0) line += " ".repeat(gap);
      line += headBoxes[i][row];
    }
    // Indent to align with connector
    const indent = " ".repeat(Math.max(0, ceoCenter - firstCenter - 1));
    lines.push(`${indent}${line}`);
  }

  // Draw worker abbreviations below each head
  let hasWorkers = false;
  let workerLine = "";

  for (let i = 0; i < tree.children.length; i++) {
    if (i > 0) workerLine += " ".repeat(gap);

    const head = tree.children[i];
    const boxW = headWidths[i] + 2;

    if (head.children.length > 0) {
      hasWorkers = true;
      const workerAbbrevs = head.children
        .map((w) => abbreviateRole(w.role))
        .join("/");
      const headColor = getAgentColor(head.role);
      const padded = workerAbbrevs
        .padStart(Math.floor((boxW + workerAbbrevs.length) / 2))
        .padEnd(boxW);
      workerLine += headColor(padded);
    } else {
      workerLine += " ".repeat(boxW);
    }
  }

  if (hasWorkers) {
    const indent = " ".repeat(Math.max(0, ceoCenter - firstCenter - 1));
    lines.push(`${indent}${workerLine}`);
  }

  return lines.join("\n");
}
