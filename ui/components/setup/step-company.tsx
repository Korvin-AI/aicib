"use client";

import { useState } from "react";
import { Building2, Rocket, Cpu, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { WizardConfig } from "./setup-wizard";

interface StepCompanyProps {
  config: WizardConfig;
  updateConfig: (partial: Partial<WizardConfig>) => void;
  onNext: () => void;
}

const personas = [
  {
    id: "professional",
    label: "Professional",
    description: "Corporate, polished, thorough",
    icon: Building2,
  },
  {
    id: "startup",
    label: "Startup",
    description: "Fast, informal, bold",
    icon: Rocket,
  },
  {
    id: "technical",
    label: "Technical",
    description: "Precise, data-driven, no fluff",
    icon: Cpu,
  },
  {
    id: "creative",
    label: "Creative",
    description: "Expressive, storytelling, metaphor-rich",
    icon: Palette,
  },
];

export function StepCompany({
  config,
  updateConfig,
  onNext,
}: StepCompanyProps) {
  const [nameError, setNameError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  function validate(): boolean {
    const name = config.companyName.trim();
    const projectDir = config.projectDir.trim();

    if (!name) {
      setNameError("Company name is required");
      return false;
    }
    if (name.length < 2) {
      setNameError("Name must be at least 2 characters");
      return false;
    }
    if (!projectDir) {
      setPathError("Project folder is required");
      return false;
    }
    setNameError(null);
    setPathError(null);
    return true;
  }

  function handleNext() {
    if (validate()) onNext();
  }

  return (
    <div className="space-y-6">
      {/* Company name */}
      <div className="space-y-2">
        <Label htmlFor="company-name" className="text-sm font-medium">
          Company Name
        </Label>
        <Input
          id="company-name"
          value={config.companyName}
          onChange={(e) => {
            updateConfig({ companyName: e.target.value });
            if (nameError) setNameError(null);
          }}
          placeholder="e.g. Acme AI, MyStartup"
          className="bg-muted/50"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleNext();
          }}
        />
        {nameError && (
          <p className="text-xs text-destructive">{nameError}</p>
        )}
      </div>

      {/* Project folder */}
      <div className="space-y-2">
        <Label htmlFor="project-dir" className="text-sm font-medium">
          Project Folder
        </Label>
        <Input
          id="project-dir"
          value={config.projectDir}
          onChange={(e) => {
            updateConfig({ projectDir: e.target.value });
            if (pathError) setPathError(null);
          }}
          placeholder="/Users/you/My Startup"
          className="bg-muted/50"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleNext();
          }}
        />
        {pathError ? (
          <p className="text-xs text-destructive">{pathError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Use a full folder path. We will create the business there.
          </p>
        )}
      </div>

      {/* Template */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Company Template</Label>
        <div
          className={cn(
            "flex cursor-default items-start gap-4 rounded-lg border p-4",
            "border-primary bg-primary/5"
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">SaaS Startup</p>
            <p className="text-xs text-muted-foreground">
              Full C-suite team: CEO, CTO, CFO, CMO + specialist workers.
              8 agents ready to build and launch your product.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          More templates coming soon
        </p>
      </div>

      {/* Persona */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Team Personality</Label>
        <p className="text-xs text-muted-foreground">
          How should your AI team communicate?
        </p>
        <div className="grid grid-cols-2 gap-3">
          {personas.map((p) => {
            const Icon = p.icon;
            const selected = config.persona === p.id;
            return (
              <button
                key={p.id}
                onClick={() => updateConfig({ persona: p.id })}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Next button */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleNext}>
          Next: Build Your Team
        </Button>
      </div>
    </div>
  );
}
