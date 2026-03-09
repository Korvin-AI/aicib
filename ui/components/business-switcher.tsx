"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BusinessDeleteDialog } from "@/components/business-delete-dialog";
import { useAuth } from "@/lib/auth-context";

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
  const auth = useAuth();
  const [data, setData] = useState<BusinessesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    projectDir: string;
  } | null>(null);

  async function loadBusinesses() {
    if (auth.isCloudMode) {
      // In cloud mode, use auth context for business list
      setLoading(false);
      return;
    }
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
  }, [auth.isCloudMode]);

  // In cloud mode, derive data from auth context
  const effectiveData = useMemo<BusinessesPayload | null>(() => {
    if (auth.isCloudMode) {
      return {
        activeBusinessId: auth.activeBusinessId,
        hasAnyBusiness: auth.businesses.length > 0,
        businesses: auth.businesses.map((b) => ({
          id: b.id,
          name: b.name,
          projectDir: "",
          template: b.template,
          sessionActive: false,
        })),
      };
    }
    return data;
  }, [auth.isCloudMode, auth.businesses, auth.activeBusinessId, data]);

  const activeBusiness = useMemo(
    () =>
      effectiveData?.businesses.find(
        (business) => business.id === effectiveData.activeBusinessId
      ) ?? null,
    [effectiveData]
  );

  async function handleSelect(businessId: string) {
    if (switchingId || businessId === effectiveData?.activeBusinessId) return;
    setSwitchingId(businessId);
    try {
      if (auth.isCloudMode) {
        auth.selectBusiness(businessId);
        window.location.reload();
      } else {
        const res = await fetch("/api/businesses/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId }),
        });
        if (res.ok) {
          window.location.reload();
        }
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

          {effectiveData?.businesses.length ? (
            effectiveData.businesses.map((business) => {
              const active = effectiveData.activeBusinessId === business.id;
              return (
                <DropdownMenuItem
                  key={business.id}
                  onSelect={(e) => {
                    if ((e.target as Element).closest?.("[data-delete-btn]")) {
                      e.preventDefault();
                      return;
                    }
                    handleSelect(business.id);
                  }}
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
                  <button
                    data-delete-btn
                    type="button"
                    className="ml-1 rounded p-0.5 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget({
                        id: business.id,
                        name: business.name,
                        projectDir: business.projectDir,
                      });
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
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
        </DropdownMenuContent>
      </DropdownMenu>

      <BusinessDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        business={deleteTarget}
        onDeleted={() => window.location.reload()}
      />
    </>
  );
}
