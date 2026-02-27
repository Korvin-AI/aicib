"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListTodo,
  DollarSign,
  Activity,
  Users,
  UserCog,
  BookOpen,
  Notebook,
  FolderKanban,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BusinessSwitcher } from "@/components/business-switcher";

const navItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/agents", label: "Team", icon: Users },
  { href: "/hr", label: "HR", icon: UserCog },
  { href: "/knowledge", label: "Wiki", icon: BookOpen },
  { href: "/journal", label: "Journal", icon: Notebook },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/costs", label: "Costs", icon: DollarSign },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 flex-col border-r border-sidebar-border bg-sidebar/95 backdrop-blur">
      <div className="border-b border-sidebar-border px-3 py-2">
        <BusinessSwitcher />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] transition-colors",
                isActive
                  ? "border border-border bg-muted/70 text-foreground font-medium"
                  : "border border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-3">
        <p className="text-[11px] text-sidebar-foreground/45">v0.1.0</p>
      </div>
    </aside>
  );
}
