"use client";

interface PageGuideProps {
  useFor: string;
  notFor: string;
  goTo: string;
}

export function PageGuide({ useFor, notFor, goTo }: PageGuideProps) {
  return (
    <div className="mb-3 rounded-lg border border-border/80 bg-card px-3 py-2">
      <p className="text-[12px]">
        <span className="font-medium text-foreground">Use this page for:</span>{" "}
        <span className="text-muted-foreground">{useFor}</span>
      </p>
      <p className="mt-1 text-[12px]">
        <span className="font-medium text-foreground">Don&apos;t use this page for:</span>{" "}
        <span className="text-muted-foreground">{notFor}</span>
      </p>
      <p className="mt-1 text-[12px]">
        <span className="font-medium text-foreground">Go to this page when needed:</span>{" "}
        <span className="text-muted-foreground">{goTo}</span>
      </p>
    </div>
  );
}
