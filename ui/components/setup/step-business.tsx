"use client";

import { useState } from "react";
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

interface StepBusinessProps {
  config: WizardConfig;
  updateProfile: (partial: Partial<BusinessProfile>) => void;
  onNext: () => void;
  onBack: () => void;
}

const challengeOptions = [
  "Growth",
  "Operations",
  "Marketing",
  "Product",
  "Funding",
  "Team Building",
];

const revenueOptions = [
  "Pre-revenue",
  "Less than $1K",
  "$1K-$10K",
  "$10K-$100K",
  "$100K+",
];

const customerCountOptions = [
  "Zero",
  "1-10",
  "11-100",
  "100-1,000",
  "1,000+",
];

export function StepBusiness({
  config,
  updateProfile,
  onNext,
  onBack,
}: StepBusinessProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const p = config.profile;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!p.whatYouSell.trim()) newErrors.whatYouSell = "Required";
    if (!p.primaryCustomer.trim()) newErrors.primaryCustomer = "Required";
    if (!p.biggestChallenge) newErrors.biggestChallenge = "Required";
    if (!p.monthlyRevenue) newErrors.monthlyRevenue = "Required";
    if (!p.customerCount) newErrors.customerCount = "Required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleNext() {
    if (validate()) onNext();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-foreground">
          About Your Business
        </h2>
        <p className="text-xs text-muted-foreground">
          Help your AI team understand what you do so they can hit the ground
          running.
        </p>
      </div>

      {/* Q1: What you sell */}
      <div className="space-y-2">
        <Label htmlFor="what-you-sell" className="text-sm font-medium">
          What does your business sell or offer?
        </Label>
        <Textarea
          id="what-you-sell"
          value={p.whatYouSell}
          onChange={(e) => {
            updateProfile({ whatYouSell: e.target.value });
            if (errors.whatYouSell) setErrors((prev) => ({ ...prev, whatYouSell: "" }));
          }}
          placeholder="e.g., We sell handmade candles online"
          className="min-h-16 bg-muted/50"
        />
        {errors.whatYouSell && (
          <p className="text-xs text-destructive">{errors.whatYouSell}</p>
        )}
      </div>

      {/* Q2: Primary customer */}
      <div className="space-y-2">
        <Label htmlFor="primary-customer" className="text-sm font-medium">
          Who&apos;s your primary customer?
        </Label>
        <Textarea
          id="primary-customer"
          value={p.primaryCustomer}
          onChange={(e) => {
            updateProfile({ primaryCustomer: e.target.value });
            if (errors.primaryCustomer) setErrors((prev) => ({ ...prev, primaryCustomer: "" }));
          }}
          placeholder="e.g., Health-conscious millennials in urban areas"
          className="min-h-16 bg-muted/50"
        />
        {errors.primaryCustomer && (
          <p className="text-xs text-destructive">{errors.primaryCustomer}</p>
        )}
      </div>

      {/* Q3: Biggest challenge */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          What&apos;s your biggest challenge?
        </Label>
        <Select
          value={p.biggestChallenge}
          onValueChange={(val) => {
            updateProfile({ biggestChallenge: val });
            if (errors.biggestChallenge) setErrors((prev) => ({ ...prev, biggestChallenge: "" }));
          }}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue placeholder="Select a challenge" />
          </SelectTrigger>
          <SelectContent>
            {challengeOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.biggestChallenge && (
          <p className="text-xs text-destructive">{errors.biggestChallenge}</p>
        )}
      </div>

      {/* Q4: Monthly revenue */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Approximate monthly revenue
        </Label>
        <Select
          value={p.monthlyRevenue}
          onValueChange={(val) => {
            updateProfile({ monthlyRevenue: val });
            if (errors.monthlyRevenue) setErrors((prev) => ({ ...prev, monthlyRevenue: "" }));
          }}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue placeholder="Select a range" />
          </SelectTrigger>
          <SelectContent>
            {revenueOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.monthlyRevenue && (
          <p className="text-xs text-destructive">{errors.monthlyRevenue}</p>
        )}
      </div>

      {/* Q5: Customer count */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          How many customers/users today?
        </Label>
        <Select
          value={p.customerCount}
          onValueChange={(val) => {
            updateProfile({ customerCount: val });
            if (errors.customerCount) setErrors((prev) => ({ ...prev, customerCount: "" }));
          }}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue placeholder="Select a range" />
          </SelectTrigger>
          <SelectContent>
            {customerCountOptions.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.customerCount && (
          <p className="text-xs text-destructive">{errors.customerCount}</p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleNext}>Next: Your Goals</Button>
      </div>
    </div>
  );
}
