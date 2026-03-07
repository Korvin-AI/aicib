"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BusinessProfile, WizardConfig } from "./setup-wizard";

interface StepGoalsProps {
  config: WizardConfig;
  updateProfile: (partial: Partial<BusinessProfile>) => void;
  onNext: () => void;
  onBack: () => void;
}

const hoursOptions = [
  "Less than 5 hours",
  "5-15 hours",
  "15-30 hours",
  "Full-time",
];

const channelOptions = [
  "Word of mouth",
  "Social media",
  "SEO/Content",
  "Paid ads",
  "Cold outreach",
];

export function StepGoals({
  config,
  updateProfile,
  onNext,
  onBack,
}: StepGoalsProps) {
  const p = config.profile;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-foreground">Your Goals</h2>
        <p className="text-xs text-muted-foreground">
          These are all optional — skip ahead to launch anytime.
        </p>
      </div>

      {/* G1: Top metric */}
      <div className="space-y-2">
        <Label htmlFor="top-metric" className="text-sm font-medium">
          What&apos;s the #1 metric you want to improve in 30 days?
        </Label>
        <Textarea
          id="top-metric"
          value={p.topMetric}
          onChange={(e) => updateProfile({ topMetric: e.target.value })}
          placeholder="e.g., Increase website traffic by 50%"
          className="min-h-16 bg-muted/50"
        />
      </div>

      {/* G2: Weekly hours */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          How much time can you dedicate each week?
        </Label>
        <Select
          value={p.weeklyHours}
          onValueChange={(val) => updateProfile({ weeklyHours: val })}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue placeholder="Select time commitment" />
          </SelectTrigger>
          <SelectContent>
            {hoursOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* G3: Automate task */}
      <div className="space-y-2">
        <Label htmlFor="automate-task" className="text-sm font-medium">
          What&apos;s one task you wish you could automate?
        </Label>
        <Textarea
          id="automate-task"
          value={p.automateTask}
          onChange={(e) => updateProfile({ automateTask: e.target.value })}
          placeholder="e.g., Writing blog posts, managing social media"
          className="min-h-16 bg-muted/50"
        />
      </div>

      {/* G4: Customer channel */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          How do you primarily reach new customers?
        </Label>
        <Select
          value={p.customerChannel}
          onValueChange={(val) => updateProfile({ customerChannel: val })}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue placeholder="Select a channel" />
          </SelectTrigger>
          <SelectContent>
            {channelOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* G5: Weekly win */}
      <div className="space-y-2">
        <Label htmlFor="weekly-win" className="text-sm font-medium">
          What would make this week a win?
        </Label>
        <Textarea
          id="weekly-win"
          value={p.weeklyWin}
          onChange={(e) => updateProfile({ weeklyWin: e.target.value })}
          placeholder="e.g., Land 3 new leads, finish the pitch deck"
          className="min-h-16 bg-muted/50"
        />
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next: Launch</Button>
      </div>
    </div>
  );
}
