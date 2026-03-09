"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSSE } from "@/components/sse-provider";
import { BusinessSwitcher } from "@/components/business-switcher";
import { useAuth } from "@/lib/auth-context";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/chat", label: "Chat" },
  { href: "/knowledge", label: "Documents" },
  { href: "/activity", label: "Activity Log" },
  { href: "/settings", label: "Settings" },
];

export function SimpleSidebar() {
  const pathname = usePathname();
  const { lastEvent } = useSSE();
  const { user, isCloudMode, logout } = useAuth();
  const [sessionActive, setSessionActive] = useState(false);

  useEffect(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((d) => {
        setSessionActive(!!d.session?.active);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    if (
      lastEvent.type === "agent_status" ||
      lastEvent.type === "new_logs" ||
      lastEvent.type === "connected"
    ) {
      fetch("/api/status", { cache: "no-store" })
        .then((res) => res.json())
        .then((d) => setSessionActive(!!d.session?.active))
        .catch(() => {});
    }
  }, [lastEvent]);

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--s-border-light)",
        backgroundColor: "#FFFFFF",
      }}
    >
      {/* Company Switcher */}
      <div
        style={{
          padding: "16px 12px 12px",
          borderBottom: "1px solid var(--s-border-light)",
        }}
      >
        <BusinessSwitcher />
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--s-text-tertiary)",
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            marginTop: 6,
            paddingLeft: 2,
          }}
        >
          AI Company Operator
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "12px 0" }}>
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive
                  ? "var(--s-text-primary)"
                  : "var(--s-text-secondary)",
                textDecoration: "none",
                borderLeft: isActive
                  ? "3px solid #3B82F6"
                  : "3px solid transparent",
                backgroundColor: isActive ? "#F0F7FF" : "transparent",
                transition: "all 0.15s ease",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* AI Team Status */}
      <div
        style={{
          padding: "16px 20px",
          borderTop: "1px solid var(--s-border-light)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--s-text-secondary)",
              fontWeight: 500,
            }}
          >
            AI Team:
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 999,
              backgroundColor: sessionActive ? "#D1FAE5" : "#F3F4F6",
              color: sessionActive ? "#059669" : "#6B7280",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: sessionActive ? "#10B981" : "#9CA3AF",
              }}
            />
            {sessionActive ? "Active" : "Stopped"}
          </span>
        </div>
      </div>

      {/* User info (cloud mode only) */}
      {isCloudMode && user && (
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--s-border-light)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--s-text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user.displayName || user.email}
            </div>
            {user.displayName && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--s-text-tertiary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {user.email}
              </div>
            )}
          </div>
          <button
            onClick={logout}
            style={{
              marginLeft: 8,
              padding: 4,
              borderRadius: 4,
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "var(--s-text-tertiary)",
              fontSize: 11,
            }}
            title="Log out"
          >
            Logout
          </button>
        </div>
      )}
    </aside>
  );
}
