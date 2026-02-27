import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  secondary?: string;
  progressValue?: number;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function StatCard({
  label,
  value,
  secondary,
  progressValue,
  trend = "neutral",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/80 bg-card p-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            {value}
          </p>
          {secondary ? (
            <p className="mt-1 text-[12px] text-muted-foreground">{secondary}</p>
          ) : null}
        </div>

        <div
          className={cn(
            "mt-1 h-2 w-2 rounded-full",
            trend === "up" && "bg-emerald-500",
            trend === "down" && "bg-red-500",
            trend === "neutral" && "bg-zinc-300"
          )}
          aria-hidden
        />
      </div>

      {typeof progressValue === "number" ? (
        <Progress
          value={Math.max(0, Math.min(progressValue, 100))}
          className="mt-3 h-1.5 bg-muted"
        />
      ) : null}
    </div>
  );
}
