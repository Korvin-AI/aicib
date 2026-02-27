"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SendResult {
  ok: boolean;
  error?: string;
}

interface ChannelComposerProps {
  channelName: string;
  disabled?: boolean;
  onSend: (message: string) => Promise<SendResult>;
}

export function ChannelComposer({
  channelName,
  disabled,
  onSend,
}: ChannelComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending || disabled) return;

    const message = text.trim();
    if (!message) return;

    setSending(true);
    setError(null);

    const result = await onSend(message);
    if (result.ok) {
      setText("");
    } else {
      setError(result.error || "Failed to send message");
    }

    setSending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border/70 px-3 py-2">
      <p className="mb-1.5 text-[11px] text-muted-foreground">
        Posting to <span className="font-medium text-foreground">{channelName}</span>
      </p>
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={2}
          placeholder="Write an instruction or update..."
          disabled={disabled || sending}
          className="min-h-20 resize-y bg-background text-[13px]"
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || sending || !text.trim()}
          className="h-9 w-9"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
      {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
    </form>
  );
}
