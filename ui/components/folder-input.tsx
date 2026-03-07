"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FolderInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoSuggestBase?: string;
  id?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "-");
}

export function FolderInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoSuggestBase,
  id,
  className,
  onKeyDown,
}: FolderInputProps) {
  const [picking, setPicking] = useState(false);
  const [homePath, setHomePath] = useState<string | null>(null);
  const userEdited = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Fetch home directory once
  useEffect(() => {
    fetch("/api/filesystem/browse")
      .then((r) => r.json())
      .then((data) => {
        if (data.homePath) setHomePath(data.homePath);
      })
      .catch(() => {});
  }, []);

  // Auto-suggest path when company name changes (only if user hasn't manually edited)
  useEffect(() => {
    if (!autoSuggestBase || !homePath || userEdited.current) return;
    const sanitized = sanitizeName(autoSuggestBase);
    if (sanitized) {
      onChangeRef.current(`${homePath}/Documents/${sanitized}`);
    }
  }, [autoSuggestBase, homePath]);

  async function handleBrowse() {
    setPicking(true);
    try {
      const res = await fetch("/api/filesystem/pick", { method: "POST" });
      const data = await res.json();
      if (data.path) {
        userEdited.current = true;
        onChange(data.path);
      }
    } catch {
      // ignore — user may have cancelled or osascript failed
    } finally {
      setPicking(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          userEdited.current = true;
          onChange(e.target.value);
        }}
        placeholder={placeholder || "/Users/you/My Startup"}
        className={className}
        disabled={disabled}
        onKeyDown={onKeyDown}
      />
      <Button
        type="button"
        variant="outline"
        onClick={handleBrowse}
        disabled={disabled || picking}
        className="shrink-0 gap-1.5"
      >
        {picking ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FolderOpen className="h-4 w-4" />
        )}
        Browse
      </Button>
    </div>
  );
}
