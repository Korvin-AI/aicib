"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [loading] = useState(true);

  useEffect(() => {
    fetch("/api/businesses", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload: { hasAnyBusiness?: boolean }) => {
        if (payload.hasAnyBusiness) {
          router.replace("/");
        } else {
          router.replace("/businesses/new");
        }
      })
      .catch(() => {
        router.replace("/businesses/new");
      });
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return null;
}
