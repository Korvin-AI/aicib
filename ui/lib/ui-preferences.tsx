"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

type UIMode = "simple" | "pro";
type ActivityViewMode = "simple" | "detailed";

interface UIPreferencesContextValue {
  uiMode: UIMode;
  setUiMode: (mode: UIMode) => void;
  activitySidebarOpen: boolean;
  setActivitySidebarOpen: (open: boolean) => void;
  activityViewMode: ActivityViewMode;
  setActivityViewMode: (mode: ActivityViewMode) => void;
  hydrated: boolean;
}

const UIPreferencesContext = createContext<UIPreferencesContextValue>({
  uiMode: "simple",
  setUiMode: () => {},
  activitySidebarOpen: true,
  setActivitySidebarOpen: () => {},
  activityViewMode: "simple",
  setActivityViewMode: () => {},
  hydrated: false,
});

const LS_UI_MODE = "aicib-ui-mode";
const LS_ACTIVITY_SIDEBAR = "aicib-activity-sidebar";
const LS_ACTIVITY_VIEW = "aicib-activity-view";

export function UIPreferencesProvider({ children }: { children: ReactNode }) {
  const [uiMode, setUiModeState] = useState<UIMode>("simple");
  const [activitySidebarOpen, setActivitySidebarOpenState] = useState(true);
  const [activityViewMode, setActivityViewModeState] =
    useState<ActivityViewMode>("simple");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(LS_UI_MODE);
      if (storedMode === "simple" || storedMode === "pro") {
        setUiModeState(storedMode);
      }

      const storedSidebar = localStorage.getItem(LS_ACTIVITY_SIDEBAR);
      if (storedSidebar === "false") {
        setActivitySidebarOpenState(false);
      }

      const storedView = localStorage.getItem(LS_ACTIVITY_VIEW);
      if (storedView === "simple" || storedView === "detailed") {
        setActivityViewModeState(storedView);
      }
    } catch {
      // localStorage unavailable (SSR or privacy mode)
    }
    setHydrated(true);
  }, []);

  const setUiMode = useCallback((mode: UIMode) => {
    setUiModeState(mode);
    try {
      localStorage.setItem(LS_UI_MODE, mode);
    } catch {}
  }, []);

  const setActivitySidebarOpen = useCallback((open: boolean) => {
    setActivitySidebarOpenState(open);
    try {
      localStorage.setItem(LS_ACTIVITY_SIDEBAR, String(open));
    } catch {}
  }, []);

  const setActivityViewMode = useCallback((mode: ActivityViewMode) => {
    setActivityViewModeState(mode);
    try {
      localStorage.setItem(LS_ACTIVITY_VIEW, mode);
    } catch {}
  }, []);

  return (
    <UIPreferencesContext.Provider
      value={{
        uiMode,
        setUiMode,
        activitySidebarOpen,
        setActivitySidebarOpen,
        activityViewMode,
        setActivityViewMode,
        hydrated,
      }}
    >
      {children}
    </UIPreferencesContext.Provider>
  );
}

export function useUIPreferences(): UIPreferencesContextValue {
  return useContext(UIPreferencesContext);
}
