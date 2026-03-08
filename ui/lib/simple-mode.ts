import { getAgentHexColor } from "@/lib/agent-colors";

interface StatusDisplay {
  label: string;
  color: string;
  lightColor: string;
}

const STATUS_MAP: Record<string, StatusDisplay> = {
  done: { label: "Completed", color: "#10B981", lightColor: "#D1FAE5" },
  in_progress: { label: "In Progress", color: "#3B82F6", lightColor: "#DBEAFE" },
  in_review: { label: "Awaiting Approval", color: "#F59E0B", lightColor: "#FEF3C7" },
  todo: { label: "Planned", color: "#9CA3AF", lightColor: "#F3F4F6" },
  backlog: { label: "Queued", color: "#9CA3AF", lightColor: "#F3F4F6" },
  cancelled: { label: "Failed", color: "#EF4444", lightColor: "#FEE2E2" },
};

export function getStatusDisplay(status: string): StatusDisplay {
  return STATUS_MAP[status] || { label: status, color: "#9CA3AF", lightColor: "#F3F4F6" };
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function getFormattedDate(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export function getDeptColor(role: string): string {
  return getAgentHexColor(role);
}

export function getRoleInitials(role: string): string {
  if (!role) return "SYS";
  if (role.length <= 4) return role.toUpperCase();
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

export function formatRoleName(role: string): string {
  if (!role) return "System";
  if (role.length <= 4) return role.toUpperCase();
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const STATUS_PRIORITY: Record<string, number> = {
  in_progress: 0,
  in_review: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  cancelled: 5,
};
