"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { WizardConfig } from "./setup-wizard";

interface StepBudgetProps {
  config: WizardConfig;
  updateConfig: (partial: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepBudget({
  config,
  updateConfig,
  onNext,
  onBack,
}: StepBudgetProps) {
  const estimatedBriefs = Math.floor(config.dailyLimit / 1.5);
  const monthlyWarning = config.monthlyLimit < config.dailyLimit * 30;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-foreground">Spending Limits</h2>
        <p className="text-xs text-muted-foreground">
          Set daily and monthly cost caps for your AI team. You can change these
          later in Settings.
        </p>
      </div>

      {/* Daily limit */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Daily Limit</Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={config.dailyLimit}
              onChange={(e) => {
                const val = Math.max(1, Math.min(500, Number(e.target.value) || 1));
                updateConfig({ dailyLimit: val });
              }}
              className="h-8 w-20 bg-muted/50 text-right text-sm"
            />
          </div>
        </div>
        <Slider
          value={[config.dailyLimit]}
          onValueChange={([val]) => updateConfig({ dailyLimit: val })}
          min={1}
          max={500}
          step={1}
        />
        <p className="text-xs text-muted-foreground">
          ~{estimatedBriefs} briefs per day at typical costs ($1.50 avg)
        </p>
      </div>

      {/* Monthly limit */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Monthly Limit</Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              min={10}
              max={5000}
              value={config.monthlyLimit}
              onChange={(e) => {
                const val = Math.max(10, Math.min(5000, Number(e.target.value) || 10));
                updateConfig({ monthlyLimit: val });
              }}
              className="h-8 w-20 bg-muted/50 text-right text-sm"
            />
          </div>
        </div>
        <Slider
          value={[config.monthlyLimit]}
          onValueChange={([val]) => updateConfig({ monthlyLimit: val })}
          min={10}
          max={5000}
          step={10}
        />
        {monthlyWarning && (
          <p className={cn("text-xs text-amber-500")}>
            Monthly limit is less than 30 days of daily spending (${config.dailyLimit * 30}).
            Your team may hit the monthly cap before month-end.
          </p>
        )}
      </div>

      {/* Cost estimate card */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-xs font-medium text-foreground">Cost Estimate</p>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Average brief cost</span>
            <span>~$1.50</span>
          </div>
          <div className="flex justify-between">
            <span>Max briefs per day</span>
            <span>~{estimatedBriefs}</span>
          </div>
          <div className="flex justify-between">
            <span>Max briefs per month</span>
            <span>~{Math.floor(config.monthlyLimit / 1.5)}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next: Review & Launch</Button>
      </div>
    </div>
  );
}
