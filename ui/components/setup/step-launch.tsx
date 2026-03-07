"use client";

import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  FileText,
  MessageSquare,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { WizardConfig, AgentConfig } from "./setup-wizard";

interface StepLaunchProps {
  config: WizardConfig;
  defaultAgents: AgentConfig[];
  files: File[];
  onBack: () => void;
}

type LaunchPhase =
  | "idle"
  | "creating"
  | "uploading"
  | "scraping"
  | "redirecting"
  | "error";

const phaseMessages: Record<LaunchPhase, string> = {
  idle: "",
  creating: "Setting up your AI company...",
  uploading: "Importing your documents...",
  scraping: "Reading your website...",
  redirecting: "Opening dashboard...",
  error: "",
};

const phaseProgress: Record<LaunchPhase, number> = {
  idle: 0,
  creating: 30,
  uploading: 60,
  scraping: 80,
  redirecting: 100,
  error: 0,
};

function getSevenDayPlan(challenge: string): string {
  const plans: Record<string, string[]> = {
    Growth: [
      "Identify top 3 growth channels and set baseline metrics",
      "Analyze competitor positioning and find gaps",
      "Create a lead magnet or sign-up incentive",
      "Reach out to 10 potential customers for feedback",
      "Build a simple referral or sharing mechanism",
      "Set up conversion tracking and key metrics",
      "Review progress and plan next week's growth experiments",
    ],
    Marketing: [
      "Audit current brand messaging and value proposition",
      "Define 3 content pillars for your target audience",
      "Create first piece of content or marketing material",
      "Set up social media presence on 2 key platforms",
      "Design an email capture and nurture sequence",
      "Set up tracking and key marketing metrics",
      "Review performance and plan next week's campaigns",
    ],
    Product: [
      "List top 5 user pain points from feedback or research",
      "Prioritize features by impact vs. effort",
      "Ship one small improvement customers will notice",
      "Set up user feedback collection mechanism",
      "Analyze usage patterns and identify drop-off points",
      "Define key product metrics and tracking",
      "Review findings and plan next sprint",
    ],
    Operations: [
      "Map your current workflows and identify bottlenecks",
      "Automate the most repetitive manual task",
      "Set up key operational metrics and a simple dashboard",
      "Document your core processes for the AI team",
      "Identify and eliminate one unnecessary step in each workflow",
      "Create escalation paths and contingency plans",
      "Review efficiency gains and plan next optimizations",
    ],
    Funding: [
      "Clarify funding goal, timeline, and use-of-funds breakdown",
      "Research 20 potential investors or grant programs",
      "Draft a one-page executive summary and pitch deck outline",
      "Build a financial model with 12-month projections",
      "Prepare key traction metrics and proof points",
      "Create outreach list and draft personalized intro emails",
      "Review materials with a peer and refine for Day 8+ outreach",
    ],
    "Team Building": [
      "Define the 3 most critical roles you need to fill",
      "Write clear job descriptions with must-have vs. nice-to-have skills",
      "Post openings on 3 relevant job boards or communities",
      "Review applications and shortlist top candidates",
      "Conduct initial screening calls with top picks",
      "Design a simple skills assessment or trial task",
      "Review pipeline and plan interview rounds for next week",
    ],
    default: [
      "Define core value proposition and target audience",
      "Set up digital presence and landing page",
      "Create first piece of content or marketing material",
      "Reach out to 10 potential customers for feedback",
      "Analyze feedback and refine offering",
      "Set up tracking and key metrics",
      "Review progress and plan next week",
    ],
  };

  const steps = plans[challenge] || plans.default;
  return steps.map((s, i) => `Day ${i + 1}: ${s}`).join("\n");
}

export function StepLaunch({
  config,
  defaultAgents,
  files,
  onBack,
}: StepLaunchProps) {
  const [phase, setPhase] = useState<LaunchPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failedUploads, setFailedUploads] = useState<string[]>([]);

  const p = config.profile;
  const questionsAnswered = [
    p.whatYouSell,
    p.primaryCustomer,
    p.biggestChallenge,
    p.monthlyRevenue,
    p.customerCount,
    p.topMetric,
    p.weeklyHours,
    p.automateTask,
    p.customerChannel,
    p.weeklyWin,
  ].filter((v) => v.trim()).length;

  const sevenDayPlan = getSevenDayPlan(p.biggestChallenge);

  async function handleLaunch() {
    setPhase("creating");
    setError(null);

    try {
      // Build agents map from defaults
      const agentsMap: Record<string, { enabled: boolean; model: string }> = {};
      for (const agent of defaultAgents) {
        agentsMap[agent.role] = { enabled: agent.enabled, model: agent.model };
        if (agent.workers) {
          for (const worker of agent.workers) {
            agentsMap[worker.role] = {
              enabled: worker.enabled,
              model: worker.model,
            };
          }
        }
      }

      // 1. Create business
      const createRes = await fetch("/api/businesses/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: config.companyName.trim(),
          projectDir: config.projectDir.trim(),
          template: "saas-startup",
          persona: "professional",
          agents: agentsMap,
          settings: {
            cost_limit_daily: 50,
            cost_limit_monthly: 500,
          },
          profile: config.profile,
          sevenDayPlan,
          startNow: true,
        }),
      });

      if (!createRes.ok) {
        const data = await createRes.json().catch(() => null);
        throw new Error(data?.error || "Business creation failed");
      }

      // 2. Upload files one by one
      if (files.length > 0) {
        setPhase("uploading");
        const failed: string[] = [];
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          form.append("projectDir", config.projectDir.trim());

          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: form,
          });
          if (!uploadRes.ok) {
            const data = await uploadRes.json().catch(() => null);
            console.warn(`Upload failed for ${file.name}:`, data?.error);
            failed.push(file.name);
          }
        }
        if (failed.length > 0) {
          setFailedUploads(failed);
        }
      }

      // 3. Scrape website if URL provided
      if (config.websiteUrl.trim()) {
        setPhase("scraping");
        const scrapeRes = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: config.websiteUrl.trim(),
            projectDir: config.projectDir.trim(),
          }),
        });
        // Scrape failure is non-blocking
        if (!scrapeRes.ok) {
          const data = await scrapeRes.json().catch(() => null);
          console.warn("Scrape skipped:", data?.error);
        }
      }

      // 4. Redirect
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
          Ready to Launch
        </h2>
        <p className="text-xs text-muted-foreground">
          Your AI team of 8 agents is ready to start working for you.
        </p>
      </div>

      {/* Summary card */}
      <div className="rounded-lg border border-border p-4">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Summary
        </span>
        <div className="mt-2 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Company</span>
            <span className="font-medium text-foreground">
              {config.companyName}
            </span>
          </div>
          {config.websiteUrl && (
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                Website
              </span>
              <span className="truncate text-foreground">
                {config.websiteUrl}
              </span>
            </div>
          )}
          {files.length > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Documents
              </span>
              <span className="text-foreground">
                {files.length} file{files.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              Business context
            </span>
            <span className="text-foreground">
              {questionsAnswered} of 10 questions
            </span>
          </div>
        </div>
      </div>

      {/* 7-day plan */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your 7-Day Plan
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {sevenDayPlan.split("\n").map((line) => {
            const [dayLabel, ...rest] = line.split(": ");
            return (
              <div key={dayLabel} className="flex gap-3 text-sm">
                <span className="shrink-0 font-medium text-primary">
                  {dayLabel}
                </span>
                <span className="text-muted-foreground">{rest.join(": ")}</span>
              </div>
            );
          })}
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
            Imports your documents and website content
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

      {/* Upload warnings */}
      {failedUploads.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
          <div>
            <p className="text-sm font-medium text-yellow-700">
              {failedUploads.length} file{failedUploads.length !== 1 ? "s" : ""} could not be imported
            </p>
            <p className="text-xs text-yellow-600/80">
              {failedUploads.join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === "error" && error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">Setup failed</p>
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
