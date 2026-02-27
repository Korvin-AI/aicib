"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FilterItem {
  key: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}

interface FilterBarProps {
  filters: FilterItem[];
  onChange: (key: string, value: string) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <div key={filter.key} className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {filter.label}
          </span>
          <Select value={filter.value} onValueChange={(value) => onChange(filter.key, value)}>
            <SelectTrigger className="h-8 min-w-32 bg-background text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
