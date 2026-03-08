"use client";

import { useUIPreferences } from "@/lib/ui-preferences";
import { SimpleChat } from "@/components/simple/simple-chat";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ChatPage() {
  const { uiMode } = useUIPreferences();
  const router = useRouter();

  // Pro mode doesn't have a chat page — redirect to home (which has channels)
  useEffect(() => {
    if (uiMode === "pro") {
      router.replace("/");
    }
  }, [uiMode, router]);

  if (uiMode === "pro") return null;

  return <SimpleChat />;
}
