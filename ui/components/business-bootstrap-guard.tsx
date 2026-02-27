"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

interface BusinessBootstrapGuardProps {
  children: React.ReactNode;
}

export function BusinessBootstrapGuard({ children }: BusinessBootstrapGuardProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/businesses", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload: { hasAnyBusiness?: boolean }) => {
        if (cancelled) return;
        if (!payload.hasAnyBusiness) {
          router.replace("/businesses/new");
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return <>{children}</>;
}
