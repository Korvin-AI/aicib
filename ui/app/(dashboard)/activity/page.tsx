"use client";

import { ActivityStream } from "@/components/activity-stream";
import { PageGuide } from "@/components/page-guide";

export default function ActivityPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden px-5 py-4">
      <h1 className="text-lg font-semibold tracking-tight">Activity</h1>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Execution timeline of job events and agent outputs.
      </p>
      <PageGuide
        useFor="reviewing what agents did, when they did it, and how jobs progressed."
        notFor="analyzing token/cost spend patterns."
        goTo="Costs for financial usage and spending history."
      />
      <div className="min-h-0 flex-1 rounded-lg border border-border/80 bg-card">
        <ActivityStream />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Not shown here: token-level spend ledger and budget trend analytics.
      </p>
    </div>
  );
}
