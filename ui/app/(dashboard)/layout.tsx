import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { SSEProvider } from "@/components/sse-provider";
import { BusinessBootstrapGuard } from "@/components/business-bootstrap-guard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SSEProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex flex-1 flex-col overflow-hidden">
            <BusinessBootstrapGuard>{children}</BusinessBootstrapGuard>
          </main>
        </div>
      </div>
    </SSEProvider>
  );
}
