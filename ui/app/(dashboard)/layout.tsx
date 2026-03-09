"use client";

import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { SSEProvider } from "@/components/sse-provider";
import { BusinessBootstrapGuard } from "@/components/business-bootstrap-guard";
import { UIPreferencesProvider, useUIPreferences } from "@/lib/ui-preferences";
import { AuthProvider } from "@/lib/auth-context";
import { SimpleSidebar } from "@/components/simple/simple-sidebar";
import { LiveActivitySidebar } from "@/components/simple/live-activity-sidebar";
import { ApiKeySetupGuard } from "@/components/api-key-setup-guard";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { uiMode, hydrated } = useUIPreferences();

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      </div>
    );
  }

  if (uiMode === "simple") {
    return (
      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <SimpleSidebar />
        <main
          style={{
            flex: 1,
            overflow: "auto",
            backgroundColor: "var(--s-surface-primary)",
          }}
        >
          <div
            style={{
              maxWidth: 900,
              margin: "0 auto",
              padding: "0 24px",
              minHeight: "100%",
            }}
          >
            <BusinessBootstrapGuard>
              <ApiKeySetupGuard>{children}</ApiKeySetupGuard>
            </BusinessBootstrapGuard>
          </div>
        </main>
        <LiveActivitySidebar />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <BusinessBootstrapGuard>
            <ApiKeySetupGuard>{children}</ApiKeySetupGuard>
          </BusinessBootstrapGuard>
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <SSEProvider>
        <UIPreferencesProvider>
          <DashboardShell>{children}</DashboardShell>
        </UIPreferencesProvider>
      </SSEProvider>
    </AuthProvider>
  );
}
