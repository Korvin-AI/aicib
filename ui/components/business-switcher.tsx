"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  FolderPlus,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BusinessImportDialog } from "@/components/business-import-dialog";

interface BusinessListItem {
  id: string;
  name: string;
  projectDir: string;
  template: string;
  sessionActive: boolean;
}

interface BusinessesPayload {
  activeBusinessId: string | null;
  hasAnyBusiness: boolean;
  businesses: BusinessListItem[];
}

export function BusinessSwitcher() {
  const router = useRouter();
  const [data, setData] = useState<BusinessesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  async function loadBusinesses() {
    setLoading(true);
    try {
      const res = await fetch("/api/businesses", { cache: "no-store" });
      const payload = (await res.json()) as BusinessesPayload;
      if (res.ok) {
        setData(payload);
      }
    } catch {
      // Keep previous state if refresh fails.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBusinesses();
  }, []);

  const activeBusiness = useMemo(
    () =>
      data?.businesses.find((business) => business.id === data.activeBusinessId) ??
      null,
    [data]
  );

  async function handleSelect(businessId: string) {
    if (switchingId || businessId === data?.activeBusinessId) return;
    setSwitchingId(businessId);
    try {
      const res = await fetch("/api/businesses/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar-accent/40 px-2 text-left text-[12px] text-sidebar-foreground hover:bg-sidebar-accent focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Select business"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/70" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {loading
              ? "Loading..."
              : activeBusiness?.name || "Select business"}
          </span>
          {loading || switchingId ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sidebar-foreground/50" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-sidebar-foreground/60" />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Businesses</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {data?.businesses.length ? (
            data.businesses.map((business) => {
              const active = data.activeBusinessId === business.id;
              return (
                <DropdownMenuItem
                  key={business.id}
                  onSelect={() => handleSelect(business.id)}
                  className="flex items-start gap-2"
                >
                  <div
                    className={`mt-1 h-2 w-2 rounded-full ${
                      business.sessionActive ? "bg-emerald-500" : "bg-zinc-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{business.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {business.projectDir}
                    </p>
                  </div>
                  {active ? <Check className="h-3.5 w-3.5 text-foreground" /> : null}
                </DropdownMenuItem>
              );
            })
          ) : (
            <DropdownMenuItem disabled>No businesses yet</DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => router.push("/businesses/new")}
            className="gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Create New Business
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setImportOpen(true)} className="gap-2">
            <FolderPlus className="h-3.5 w-3.5" />
            Import Existing Business
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BusinessImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => window.location.reload()}
      />
    </>
  );
}
