"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getAgentColorClasses } from "@/lib/agent-colors";
import type { AgentConfig, WizardConfig } from "./setup-wizard";

interface StepTeamProps {
  config: WizardConfig;
  updateConfig: (partial: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

const modelOptions = [
  { value: "haiku", label: "Haiku", cost: "$0.25/MTok" },
  { value: "sonnet", label: "Sonnet", cost: "$3/MTok" },
  { value: "opus", label: "Opus", cost: "$15/MTok" },
];

function AgentCard({
  agent,
  onModelChange,
}: {
  agent: AgentConfig;
  onModelChange: (model: string) => void;
}) {
  const selectedModel = modelOptions.find((m) => m.value === agent.model);

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            getAgentColorClasses(agent.role).dot
          )}
        />
        <div>
          <p className="text-sm font-medium text-foreground">{agent.title}</p>
          <p className="text-xs text-muted-foreground">{agent.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {selectedModel?.cost}
        </span>
        <Select value={agent.model} onValueChange={onModelChange}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                {m.label}{" "}
                <span className="text-muted-foreground">{m.cost}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function StepTeam({
  config,
  updateConfig,
  onNext,
  onBack,
}: StepTeamProps) {
  function updateAgentModel(role: string, model: string) {
    const newAgents = config.agents.map((agent) => {
      if (agent.role === role) {
        return { ...agent, model };
      }
      if (agent.workers) {
        return {
          ...agent,
          workers: agent.workers.map((w) =>
            w.role === role ? { ...w, model } : w
          ),
        };
      }
      return agent;
    });
    updateConfig({ agents: newAgents });
  }

  const agentCount =
    config.agents.length +
    config.agents.reduce(
      (acc, a) => acc + (a.workers?.length || 0),
      0
    );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-foreground">
          Your AI Team
        </h2>
        <p className="text-xs text-muted-foreground">
          {agentCount} agents. Choose which AI model powers each role.
        </p>
      </div>

      {/* CEO — always first */}
      {config.agents
        .filter((a) => a.role === "ceo")
        .map((agent) => (
          <div key={agent.role}>
            <Label className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Leadership
            </Label>
            <AgentCard
              agent={agent}
              onModelChange={(model) => updateAgentModel(agent.role, model)}
            />
          </div>
        ))}

      {/* Department sections */}
      {config.agents
        .filter((a) => a.role !== "ceo")
        .map((exec) => (
          <div key={exec.role} className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {exec.department}
            </Label>
            <AgentCard
              agent={exec}
              onModelChange={(model) => updateAgentModel(exec.role, model)}
            />
            {exec.workers?.map((worker) => (
              <div key={worker.role} className="ml-6">
                <AgentCard
                  agent={worker}
                  onModelChange={(model) =>
                    updateAgentModel(worker.role, model)
                  }
                />
              </div>
            ))}
          </div>
        ))}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next: Set Budget</Button>
      </div>
    </div>
  );
}
