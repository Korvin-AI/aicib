"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getAgentColorClasses } from "@/lib/agent-colors";
import type { WizardConfig } from "./setup-wizard";

interface StepReviewProps {
  config: WizardConfig;
  onBack: () => void;
}

type LaunchPhase = "idle" | "creating" | "redirecting" | "error";

const phaseMessages: Record<LaunchPhase, string> = {
  idle: "",
  creating: "Creating and starting your business...",
  redirecting: "Opening dashboard...",
  error: "",
};

const phaseProgress: Record<LaunchPhase, number> = {
  idle: 0,
  creating: 70,
  redirecting: 100,
  error: 0,
};

export function StepReview({ config, onBack }: StepReviewProps) {
  const [phase, setPhase] = useState<LaunchPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const enabledAgents = [
    ...config.agents.filter((a) => a.enabled),
    ...config.agents.flatMap((a) => a.workers?.filter((w) => w.enabled) || []),
  ];

  async function handleLaunch() {
    setPhase("creating");
    setError(null);

    try {
      // Build agents map for the API
      const agentsMap: Record<string, { enabled: boolean; model: string }> = {};
      for (const agent of config.agents) {
        agentsMap[agent.role] = {
          enabled: agent.enabled,
          model: agent.model,
        };
        if (agent.workers) {
          for (const worker of agent.workers) {
            agentsMap[worker.role] = {
              enabled: worker.enabled,
              model: worker.model,
            };
          }
        }
      }

      const createRes = await fetch("/api/businesses/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: config.companyName.trim(),
          projectDir: config.projectDir.trim(),
          template: config.template,
          persona: config.persona,
          agents: agentsMap,
          settings: {
            cost_limit_daily: config.dailyLimit,
            cost_limit_monthly: config.monthlyLimit,
          },
          startNow: true,
        }),
      });

      if (!createRes.ok) {
        const data = await createRes.json().catch(() => null);
        throw new Error(data?.error || "Business creation failed");
      }

      // Redirect to dashboard
      setPhase("redirecting");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      window.location.href = "/";
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const launching = phase !== "idle" && phase !== "error";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-foreground">
          Review & Launch
        </h2>
        <p className="text-xs text-muted-foreground">
          Everything looks good? Hit the button to create your AI company.
        </p>
      </div>

      {/* Summary */}
      <div className="space-y-4">
        {/* Company info */}
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Company
            </span>
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium text-foreground">
                {config.companyName}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Template</span>
              <span className="text-foreground">SaaS Startup</span>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Folder</span>
              <span className="truncate font-mono text-[12px] text-foreground">
                {config.projectDir}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Personality</span>
              <span className="text-foreground capitalize">
                {config.persona}
              </span>
            </div>
          </div>
        </div>

        {/* Team roster */}
        <div className="rounded-lg border border-border p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Team ({enabledAgents.length} agents)
          </span>
          <div className="mt-2 space-y-1">
            {enabledAgents.map((agent) => (
              <div
                key={agent.role}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 rounded-full ${getAgentColorClasses(agent.role).dot}`}
                  />
                  <span className="text-foreground">{agent.title}</span>
                </div>
                <span className="text-xs text-muted-foreground capitalize">
                  {agent.model}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div className="rounded-lg border border-border p-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Budget
          </span>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Daily limit</span>
              <span className="text-foreground">${config.dailyLimit}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly limit</span>
              <span className="text-foreground">${config.monthlyLimit}</span>
            </div>
          </div>
        </div>
      </div>

      {/* What happens next */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-xs font-medium text-foreground">What happens next</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            Creates your business config and workspace
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            Sets up agent definitions and database
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            Starts your AI team in the background
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            Opens the dashboard so you can send your first brief
          </li>
        </ul>
      </div>

      {/* Launch progress */}
      {launching && (
        <div className="space-y-3">
          <Progress value={phaseProgress[phase]} className="h-1.5" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {phaseMessages[phase]}
          </div>
        </div>
      )}

      {/* Error */}
      {phase === "error" && error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Setup failed
            </p>
            <p className="text-xs text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack} disabled={launching}>
          Back
        </Button>
        {phase === "error" ? (
          <Button onClick={handleLaunch}>Retry</Button>
        ) : (
          <Button onClick={handleLaunch} disabled={launching}>
            {launching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create & Launch"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
