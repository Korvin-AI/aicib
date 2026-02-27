import { cn } from "@/lib/utils";

export interface BarChartDatum {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}

interface BarChartProps {
  data: BarChartDatum[];
  orientation?: "vertical" | "horizontal";
  className?: string;
  emptyMessage?: string;
  valueFormatter?: (value: number) => string;
}

const defaultColors = [
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

export function BarChart({
  data,
  orientation = "vertical",
  className,
  emptyMessage = "No data",
  valueFormatter = (value) => value.toFixed(2),
}: BarChartProps) {
  const values = data.map((d) => d.value);
  const max = values.length > 0 ? Math.max(...values, 1) : 1;

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-[12px] text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  if (orientation === "horizontal") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {data.map((item, index) => {
          const ratio = (item.value / max) * 100;
          const color = item.color || defaultColors[index % defaultColors.length];
          return (
            <div key={`${item.label}-${index}`} className="space-y-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="truncate text-muted-foreground">{item.label}</span>
                <span className="font-medium text-foreground">{valueFormatter(item.value)}</span>
              </div>
              <div className="h-2 rounded bg-muted/70">
                <div
                  className="h-2 rounded"
                  style={{ width: `${ratio}%`, backgroundColor: color }}
                  title={item.hint || `${item.label}: ${valueFormatter(item.value)}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("grid h-40 grid-cols-1 items-end gap-2", className)}>
      <div className="flex h-full items-end gap-2">
        {data.map((item, index) => {
          const ratio = (item.value / max) * 100;
          const color = item.color || defaultColors[index % defaultColors.length];
          return (
            <div key={`${item.label}-${index}`} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="invisible text-[10px] text-muted-foreground group-hover:visible">
                {valueFormatter(item.value)}
              </div>
              <div className="flex h-full w-full items-end">
                <div
                  className="w-full rounded-t"
                  style={{ height: `${Math.max(ratio, 3)}%`, backgroundColor: color }}
                  title={item.hint || `${item.label}: ${valueFormatter(item.value)}`}
                />
              </div>
              <span className="line-clamp-1 max-w-full text-[10px] text-muted-foreground">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
