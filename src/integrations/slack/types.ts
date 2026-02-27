/**
 * Shared types, constants, and defaults for the Slack integration.
 */

// --- Config types ---

export interface SlackConfig {
  enabled: boolean;
  channel_prefix: string;
  auto_create_channels: boolean;
  thread_replies: boolean;
  show_typing: boolean;
  debounce_ms: number;
  /** Master toggle for conversational chat mode. */
  chat_enabled: boolean;
  /** Per-message budget cap (USD) for C-suite chat sessions. */
  chat_max_budget_head: number;
  /** Per-message budget cap (USD) for worker chat sessions. */
  chat_max_budget_worker: number;
  /** Milliseconds to wait for brief confirmation button click before auto-chat. */
  confirmation_timeout_ms: number;
  /** Custom display names per role, e.g. { ceo: "Alex (CEO)" }. */
  custom_display_names?: Record<string, string>;
}

export const SLACK_CONFIG_DEFAULTS: SlackConfig = {
  enabled: false,
  channel_prefix: "aicib",
  auto_create_channels: true,
  thread_replies: true,
  show_typing: true,
  debounce_ms: 2000,
  chat_enabled: true,
  chat_max_budget_head: 2.0,
  chat_max_budget_worker: 0.5,
  confirmation_timeout_ms: 30_000,
};

// --- Channel mapping ---

export interface ChannelMapping {
  department: string;
  channelId: string;
  channelName: string;
}

/**
 * Maps agent roles to Slack channel suffixes.
 * e.g. "cto" -> "engineering" means #aicib-engineering
 */
export const DEPARTMENT_CHANNEL_MAP: Record<string, string> = {
  ceo: "ceo",
  cto: "engineering",
  cfo: "finance",
  cmo: "marketing",
  "backend-engineer": "engineering",
  "frontend-engineer": "engineering",
  "financial-analyst": "finance",
  "content-writer": "marketing",
};

/**
 * All unique channel suffixes that should be created.
 */
export const CHANNEL_SUFFIXES = ["ceo", "engineering", "finance", "marketing"];

/**
 * Reverse of DEPARTMENT_CHANNEL_MAP: maps department suffix → department head role.
 */
export const DEPARTMENT_HEAD_MAP: Record<string, string> = {
  engineering: "cto",
  finance: "cfo",
  marketing: "cmo",
};

/**
 * C-suite roles that get full tools in chat mode.
 * Workers (not in this set) get talk-only chat.
 */
export const C_SUITE_ROLES = new Set(["ceo", "cto", "cfo", "cmo"]);

/**
 * Maps agent roles to Slack emoji shortcodes for message headers.
 */
export const ROLE_EMOJI: Record<string, string> = {
  ceo: ":briefcase:",
  cto: ":gear:",
  cfo: ":chart_with_upwards_trend:",
  cmo: ":megaphone:",
  "backend-engineer": ":wrench:",
  "frontend-engineer": ":art:",
  "financial-analyst": ":bar_chart:",
  "content-writer": ":pencil2:",
  system: ":robot_face:",
  subagent: ":busts_in_silhouette:",
};

// --- Database state keys ---

export const SLACK_STATE_KEYS = {
  BOT_TOKEN: "bot_token",
  APP_TOKEN: "app_token",
  DAEMON_PID: "daemon_pid",
  DAEMON_HEARTBEAT: "daemon_heartbeat",
  CONNECTION_STATE: "connection_state",
  TEAM_ID: "team_id",
  TEAM_NAME: "team_name",
} as const;

// --- Slack message limits ---

export const SLACK_BLOCK_TEXT_LIMIT = 3000;
export const SLACK_MESSAGE_TOTAL_LIMIT = 40000;
