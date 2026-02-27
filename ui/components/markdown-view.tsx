import { Fragment } from "react";
import { cn } from "@/lib/utils";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/`([^`]+)`/);
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    const italicMatch = remaining.match(/\*([^*]+)\*/);

    const matches = [codeMatch, boldMatch, italicMatch].filter(
      (match): match is RegExpMatchArray => !!match && typeof match.index === "number"
    );

    if (matches.length === 0) {
      parts.push(<Fragment key={`text-${key++}`}>{remaining}</Fragment>);
      break;
    }

    matches.sort((a, b) => (a.index || 0) - (b.index || 0));
    const match = matches[0];
    const start = match.index || 0;

    if (start > 0) {
      parts.push(
        <Fragment key={`text-${key++}`}>{remaining.slice(0, start)}</Fragment>
      );
    }

    if (match === codeMatch) {
      parts.push(
        <code
          key={`code-${key++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]"
        >
          {match[1]}
        </code>
      );
    } else if (match === boldMatch) {
      parts.push(
        <strong key={`bold-${key++}`} className="font-semibold text-foreground">
          {match[1]}
        </strong>
      );
    } else {
      parts.push(
        <em key={`italic-${key++}`} className="italic">
          {match[1]}
        </em>
      );
    }

    remaining = remaining.slice(start + match[0].length);
  }

  return parts;
}

export function MarkdownView({ content, className }: MarkdownViewProps) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let listBuffer: string[] = [];

  function flushList() {
    if (listBuffer.length === 0) return;
    elements.push(
      <ul key={`list-${elements.length}`} className="ml-4 list-disc space-y-1">
        {listBuffer.map((item, idx) => (
          <li key={`li-${idx}`} className="text-[13px] leading-relaxed text-foreground">
            {renderInline(item)}
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  function flushCode() {
    if (codeBuffer.length === 0) return;
    elements.push(
      <pre
        key={`code-${elements.length}`}
        className="overflow-x-auto rounded-lg bg-muted p-3 text-[12px]"
      >
        <code>{codeBuffer.join("\n")}</code>
      </pre>
    );
    codeBuffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```") && !inCodeBlock) {
      flushList();
      inCodeBlock = true;
      continue;
    }

    if (line.startsWith("```") && inCodeBlock) {
      inCodeBlock = false;
      flushCode();
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
      continue;
    }

    flushList();

    if (!line) {
      elements.push(<div key={`sp-${elements.length}`} className="h-1" />);
      continue;
    }

    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${elements.length}`} className="text-[15px] font-semibold text-foreground">
          {renderInline(line.slice(4))}
        </h3>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${elements.length}`} className="text-[17px] font-semibold text-foreground">
          {renderInline(line.slice(3))}
        </h2>
      );
      continue;
    }

    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={`h1-${elements.length}`} className="text-lg font-semibold text-foreground">
          {renderInline(line.slice(2))}
        </h1>
      );
      continue;
    }

    elements.push(
      <p key={`p-${elements.length}`} className="text-[13px] leading-relaxed text-foreground">
        {renderInline(line)}
      </p>
    );
  }

  flushList();
  flushCode();

  if (elements.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No content</p>;
  }

  return <div className={cn("space-y-2", className)}>{elements}</div>;
}
