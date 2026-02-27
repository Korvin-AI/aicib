import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const templates = [
  {
    id: "saas-startup",
    name: "SaaS Startup",
    description:
      "Full C-suite team for building and launching a SaaS product",
    agents: [
      {
        role: "ceo",
        title: "CEO",
        department: "executive",
        model: "opus",
        description: "Strategic leader and team coordinator",
      },
      {
        role: "cto",
        title: "CTO",
        department: "engineering",
        model: "opus",
        description: "Technical architecture and engineering leadership",
        workers: [
          {
            role: "backend-engineer",
            model: "sonnet",
            description: "Backend development",
          },
          {
            role: "frontend-engineer",
            model: "sonnet",
            description: "Frontend development",
          },
        ],
      },
      {
        role: "cfo",
        title: "CFO",
        department: "finance",
        model: "sonnet",
        description: "Financial planning and budget management",
        workers: [
          {
            role: "financial-analyst",
            model: "sonnet",
            description: "Financial analysis and reporting",
          },
        ],
      },
      {
        role: "cmo",
        title: "CMO",
        department: "marketing",
        model: "sonnet",
        description: "Marketing strategy and brand building",
        workers: [
          {
            role: "content-writer",
            model: "sonnet",
            description: "Content creation and copywriting",
          },
        ],
      },
    ],
  },
];

export async function GET() {
  return NextResponse.json({ templates });
}
