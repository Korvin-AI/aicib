"use client";

import { useState } from "react";
import { StepCompany } from "./step-company";
import { StepTeam } from "./step-team";
import { StepBudget } from "./step-budget";
import { StepReview } from "./step-review";
import { cn } from "@/lib/utils";

export interface AgentConfig {
  role: string;
  title: string;
  department: string;
  model: string;
  description: string;
  enabled: boolean;
  workers?: AgentConfig[];
}

export interface WizardConfig {
  companyName: string;
  projectDir: string;
  template: string;
  persona: string;
  agents: AgentConfig[];
  dailyLimit: number;
  monthlyLimit: number;
}

const defaultAgents: AgentConfig[] = [
  {
    role: "ceo",
    title: "CEO",
    department: "executive",
    model: "opus",
    description: "Strategic leader and team coordinator",
    enabled: true,
    workers: [],
  },
  {
    role: "cto",
    title: "CTO",
    department: "engineering",
    model: "opus",
    description: "Technical architecture and engineering leadership",
    enabled: true,
    workers: [
      {
        role: "backend-engineer",
        title: "Backend Engineer",
        department: "engineering",
        model: "sonnet",
        description: "Backend development",
        enabled: true,
      },
      {
        role: "frontend-engineer",
        title: "Frontend Engineer",
        department: "engineering",
        model: "sonnet",
        description: "Frontend development",
        enabled: true,
      },
    ],
  },
  {
    role: "cfo",
    title: "CFO",
    department: "finance",
    model: "sonnet",
    description: "Financial planning and budget management",
    enabled: true,
    workers: [
      {
        role: "financial-analyst",
        title: "Financial Analyst",
        department: "finance",
        model: "sonnet",
        description: "Financial analysis and reporting",
        enabled: true,
      },
    ],
  },
  {
    role: "cmo",
    title: "CMO",
    department: "marketing",
    model: "sonnet",
    description: "Marketing strategy and brand building",
    enabled: true,
    workers: [
      {
        role: "content-writer",
        title: "Content Writer",
        department: "marketing",
        model: "sonnet",
        description: "Content creation and copywriting",
        enabled: true,
      },
    ],
  },
];

type WizardStep = "company" | "team" | "budget" | "review";

const steps: { key: WizardStep; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "team", label: "Team" },
  { key: "budget", label: "Budget" },
  { key: "review", label: "Launch" },
];

export function SetupWizard() {
  const [step, setStep] = useState<WizardStep>("company");
  const [config, setConfig] = useState<WizardConfig>({
    companyName: "",
    projectDir: "",
    template: "saas-startup",
    persona: "professional",
    agents: defaultAgents,
    dailyLimit: 50,
    monthlyLimit: 500,
  });

  const currentIndex = steps.findIndex((s) => s.key === step);

  function goNext() {
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1].key);
    }
  }

  function goBack() {
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1].key);
    }
  }

  function updateConfig(partial: Partial<WizardConfig>) {
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Create Your AI Company
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set up your AI-powered team in a few simple steps
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <button
              onClick={() => {
                // Only allow going back to completed steps
                if (i < currentIndex) setStep(s.key);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
                i === currentIndex
                  ? "bg-primary text-primary-foreground"
                  : i < currentIndex
                    ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {i + 1}
            </button>
            <span
              className={cn(
                "text-xs font-medium",
                i === currentIndex
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "h-px w-8",
                  i < currentIndex ? "bg-primary/40" : "bg-border"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="rounded-lg border border-border bg-card p-6">
        {step === "company" && (
          <StepCompany
            config={config}
            updateConfig={updateConfig}
            onNext={goNext}
          />
        )}
        {step === "team" && (
          <StepTeam
            config={config}
            updateConfig={updateConfig}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === "budget" && (
          <StepBudget
            config={config}
            updateConfig={updateConfig}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === "review" && (
          <StepReview config={config} onBack={goBack} />
        )}
      </div>
    </div>
  );
}
