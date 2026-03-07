"use client";

import { useRef, useState } from "react";
import { StepCompanyInfo } from "./step-company-info";
import { StepBusiness } from "./step-business";
import { StepGoals } from "./step-goals";
import { StepLaunch } from "./step-launch";
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

export interface BusinessProfile {
  whatYouSell: string;
  primaryCustomer: string;
  biggestChallenge: string;
  monthlyRevenue: string;
  customerCount: string;
  topMetric: string;
  weeklyHours: string;
  automateTask: string;
  customerChannel: string;
  weeklyWin: string;
}

export interface WizardConfig {
  companyName: string;
  projectDir: string;
  websiteUrl: string;
  profile: BusinessProfile;
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

const emptyProfile: BusinessProfile = {
  whatYouSell: "",
  primaryCustomer: "",
  biggestChallenge: "",
  monthlyRevenue: "",
  customerCount: "",
  topMetric: "",
  weeklyHours: "",
  automateTask: "",
  customerChannel: "",
  weeklyWin: "",
};

type WizardStep = "company-info" | "business" | "goals" | "launch";

const steps: { key: WizardStep; label: string }[] = [
  { key: "company-info", label: "Company Info" },
  { key: "business", label: "About Your Business" },
  { key: "goals", label: "Your Goals" },
  { key: "launch", label: "Launch" },
];

export function SetupWizard() {
  const [step, setStep] = useState<WizardStep>("company-info");
  const [config, setConfig] = useState<WizardConfig>({
    companyName: "",
    projectDir: "",
    websiteUrl: "",
    profile: { ...emptyProfile },
  });
  const filesRef = useRef<File[]>([]);
  const [, forceUpdate] = useState(0);

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

  function updateProfile(partial: Partial<BusinessProfile>) {
    setConfig((prev) => ({
      ...prev,
      profile: { ...prev.profile, ...partial },
    }));
  }

  function handleFilesChange(newFiles: File[]) {
    filesRef.current = newFiles;
    forceUpdate((n) => n + 1);
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
        {step === "company-info" && (
          <StepCompanyInfo
            config={config}
            updateConfig={updateConfig}
            files={filesRef.current}
            onFilesChange={handleFilesChange}
            onNext={goNext}
          />
        )}
        {step === "business" && (
          <StepBusiness
            config={config}
            updateProfile={updateProfile}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === "goals" && (
          <StepGoals
            config={config}
            updateProfile={updateProfile}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === "launch" && (
          <StepLaunch
            config={config}
            defaultAgents={defaultAgents}
            files={filesRef.current}
            onBack={goBack}
          />
        )}
      </div>
    </div>
  );
}
