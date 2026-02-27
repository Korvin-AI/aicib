"use client";

import {
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import { getAgentHexColor } from "@/lib/agent-colors";
import { useSSE } from "@/components/sse-provider";
import { AgentNode } from "@/components/agent-node";
import { AgentPanel } from "@/components/agent-panel";

interface Agent {
  role: string;
  model: string;
  department: string;
  enabled: boolean;
  status: string;
  currentTask: string | null;
  displayName?: string | null;
}

interface LogEntry {
  id: number;
  job_id: number;
  timestamp: string;
  message_type: string;
  agent_role: string;
  content: string;
}

interface Line {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Pulse {
  from: string;
  to: string;
  key: number;
}

function getParentRole(agent: Agent): string | null {
  if (agent.role === "ceo") return null;
  if (agent.department === agent.role) return "ceo";
  return agent.department;
}

export function OrgChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const pulseCounter = useRef(0);
  const { lastEvent } = useSSE();

  // Build tree structure from agents
  const { ceo, executives, allWorkers, edges } = useMemo(() => {
    const ceo = agents.find((a) => a.role === "ceo") || null;
    const executives = agents.filter(
      (a) => a.department === a.role && a.role !== "ceo"
    );
    const workersByExec = new Map<string, Agent[]>();
    const edgeList: Array<{ from: string; to: string }> = [];
    const allWorkersList: Agent[] = [];

    agents.forEach((a) => {
      if (a.department !== a.role && a.role !== "ceo") {
        const existing = workersByExec.get(a.department) || [];
        existing.push(a);
        workersByExec.set(a.department, existing);
      }
    });

    if (ceo) {
      executives.forEach((exec) => {
        edgeList.push({ from: "ceo", to: exec.role });
        const workers = workersByExec.get(exec.role) || [];
        workers.forEach((w) => {
          edgeList.push({ from: exec.role, to: w.role });
        });
        allWorkersList.push(...workers);
      });
    }

    return {
      ceo,
      executives,
      workersByExec,
      allWorkers: allWorkersList,
      edges: edgeList,
    };
  }, [agents]);

  const measureLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const newLines: Line[] = [];
    edges.forEach(({ from, to }) => {
      const fromEl = nodeRefs.current.get(from);
      const toEl = nodeRefs.current.get(to);
      if (!fromEl || !toEl) return;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      newLines.push({
        from,
        to,
        x1: fromRect.left + fromRect.width / 2 - containerRect.left,
        y1: fromRect.top + fromRect.height - containerRect.top,
        x2: toRect.left + toRect.width / 2 - containerRect.left,
        y2: toRect.top - containerRect.top,
      });
    });
    setLines(newLines);
  }, [edges]);

  // Fetch initial data
  useEffect(() => {
    fetch("/api/status")
      .then((res) => res.json())
      .then((d) => {
        if (d.agents) {
          setAgents(d.agents);
          const statusMap = new Map<string, string>();
          (d.agents as Agent[]).forEach((a) =>
            statusMap.set(a.role, a.status)
          );
          prevStatusRef.current = statusMap;
        }
        if (d.recentLogs) {
          setLogs(d.recentLogs);
        }
      })
      .catch(() => {});
  }, []);

  // Handle SSE events
  useEffect(() => {
    if (lastEvent?.type === "agent_status") {
      fetch("/api/status")
        .then((res) => res.json())
        .then((d) => {
          if (d.agents) {
            const newAgents = d.agents as Agent[];
            const newPulses: Pulse[] = [];

            newAgents.forEach((agent) => {
              const prevStatus = prevStatusRef.current.get(agent.role);
              if (
                prevStatus &&
                prevStatus !== "working" &&
                agent.status === "working"
              ) {
                const parentRole = getParentRole(agent);
                if (parentRole) {
                  newPulses.push({
                    from: parentRole,
                    to: agent.role,
                    key: ++pulseCounter.current,
                  });
                }
              }
              prevStatusRef.current.set(agent.role, agent.status);
            });

            setAgents(newAgents);

            if (newPulses.length > 0) {
              setPulses((prev) => [...prev, ...newPulses]);
              setTimeout(() => {
                setPulses((prev) =>
                  prev.filter(
                    (p) => !newPulses.some((np) => np.key === p.key)
                  )
                );
              }, 700);
            }
          }
          if (d.recentLogs) {
            setLogs(d.recentLogs);
          }
        })
        .catch(() => {});
    }

    if (lastEvent?.type === "new_logs" && Array.isArray(lastEvent.data)) {
      setLogs((prev) => {
        const newEntries = lastEvent.data as LogEntry[];
        const existingIds = new Set(prev.map((l) => l.id));
        const unique = newEntries.filter((l) => !existingIds.has(l.id));
        if (unique.length === 0) return prev;
        return [...prev, ...unique].slice(-100);
      });
    }
  }, [lastEvent]);

  // Measure lines after DOM updates
  useLayoutEffect(() => {
    measureLines();
  }, [measureLines]);

  // Re-measure on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => measureLines());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measureLines]);

  // Keep selectedAgent in sync with latest agent data
  const currentSelectedAgent = selectedAgent
    ? agents.find((a) => a.role === selectedAgent.role) || null
    : null;

  const selectedLogs = currentSelectedAgent
    ? logs
        .filter((l) => l.agent_role === currentSelectedAgent.role)
        .slice(-10)
        .reverse()
    : [];

  // Ref setter factory
  const setNodeRef = useCallback(
    (role: string) => (el: HTMLDivElement | null) => {
      if (el) nodeRefs.current.set(role, el);
      else nodeRefs.current.delete(role);
    },
    []
  );

  if (agents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-muted-foreground/40">
          No agents configured. Send a brief to get started.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className="relative flex flex-1 flex-col items-center justify-center gap-16 bg-background px-8 py-6"
      >
        {/* SVG overlay for connection lines and pulses */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {lines.map((line) => (
            <line
              key={`${line.from}-${line.to}`}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="#d1d5db"
              strokeWidth={1.5}
            />
          ))}
          {pulses.map((pulse) => {
            const line = lines.find(
              (l) => l.from === pulse.from && l.to === pulse.to
            );
            if (!line) return null;
            const hexColor = getAgentHexColor(pulse.to);
            return (
              <circle key={pulse.key} r="4" fill={hexColor}>
                <animateMotion
                  dur="0.6s"
                  fill="freeze"
                  path={`M ${line.x1} ${line.y1} L ${line.x2} ${line.y2}`}
                />
                <animate
                  attributeName="opacity"
                  from="1"
                  to="0"
                  dur="0.6s"
                  fill="freeze"
                />
              </circle>
            );
          })}
        </svg>

        {/* Tier 1: CEO */}
        {ceo && (
          <div className="flex justify-center">
            <AgentNode
              ref={setNodeRef(ceo.role)}
              role={ceo.role}
              status={ceo.status}
              hexColor={getAgentHexColor(ceo.role)}
              onClick={() => setSelectedAgent(ceo)}
            />
          </div>
        )}

        {/* Tier 2: Executives */}
        <div className="flex justify-center gap-20">
          {executives.map((exec) => (
            <AgentNode
              key={exec.role}
              ref={setNodeRef(exec.role)}
              role={exec.role}
              status={exec.status}
              hexColor={getAgentHexColor(exec.role)}
              onClick={() => setSelectedAgent(exec)}
            />
          ))}
        </div>

        {/* Tier 3: Workers */}
        {allWorkers.length > 0 && (
          <div className="flex justify-center gap-16">
            {allWorkers.map((worker) => (
              <AgentNode
                key={worker.role}
                ref={setNodeRef(worker.role)}
                role={worker.role}
                status={worker.status}
                hexColor={getAgentHexColor(worker.role)}
                onClick={() => setSelectedAgent(worker)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Agent detail slide-out panel */}
      <AgentPanel
        agent={currentSelectedAgent}
        logs={selectedLogs}
        agents={agents}
        open={!!currentSelectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
    </>
  );
}
