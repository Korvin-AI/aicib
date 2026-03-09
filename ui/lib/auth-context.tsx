"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface AuthOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

interface AuthBusiness {
  id: string;
  name: string;
  template: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  org: AuthOrg | null;
  businesses: AuthBusiness[];
  activeBusinessId: string | null;
  loading: boolean;
  isCloudMode: boolean;
  logout: () => Promise<void>;
  selectBusiness: (id: string) => void;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  org: null,
  businesses: [],
  activeBusinessId: null,
  loading: true,
  isCloudMode: false,
  logout: async () => {},
  selectBusiness: () => {},
  refreshAuth: async () => {},
});

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax${secure}`;
}

const IS_CLOUD = process.env.NEXT_PUBLIC_CLOUD_MODE === "true";

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [org, setOrg] = useState<AuthOrg | null>(null);
  const [businesses, setBusinesses] = useState<AuthBusiness[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(IS_CLOUD);

  const refreshAuth = useCallback(async () => {
    if (!IS_CLOUD) return;
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.status === 401) {
        setUser(null);
        setOrg(null);
        setBusinesses([]);
        setActiveBusinessId(null);
        router.push("/login");
        return;
      }
      const data = await res.json();
      setUser(data.user ?? null);
      setOrg(data.org ?? null);
      setBusinesses(data.businesses ?? []);

      // Restore active business from cookie or default to first
      const savedBiz = getCookie("aicib_business_id");
      const bizList: AuthBusiness[] = data.businesses ?? [];
      if (savedBiz && bizList.some((b) => b.id === savedBiz)) {
        setActiveBusinessId(savedBiz);
      } else if (bizList.length > 0) {
        setActiveBusinessId(bizList[0].id);
        setCookie("aicib_business_id", bizList[0].id, 365);
      }
    } catch {
      // Network error — keep current state
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort
    }
    setUser(null);
    setOrg(null);
    setBusinesses([]);
    setActiveBusinessId(null);
    router.push("/login");
  }, [router]);

  const selectBusiness = useCallback((id: string) => {
    setActiveBusinessId(id);
    setCookie("aicib_business_id", id, 365);
    // Also call the select endpoint so the proxy knows
    fetch("/api/businesses/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: id }),
    }).catch(() => {});
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        org,
        businesses,
        activeBusinessId,
        loading,
        isCloudMode: IS_CLOUD,
        logout,
        selectBusiness,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
