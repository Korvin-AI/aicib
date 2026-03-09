"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderInput } from "@/components/folder-input";
import { FileDropzone } from "./file-dropzone";
import { isCloudMode } from "@/lib/cloud-mode";
import type { WizardConfig } from "./setup-wizard";

interface StepCompanyInfoProps {
  config: WizardConfig;
  updateConfig: (partial: Partial<WizardConfig>) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onNext: () => void;
}

export function StepCompanyInfo({
  config,
  updateConfig,
  files,
  onFilesChange,
  onNext,
}: StepCompanyInfoProps) {
  const IS_CLOUD = isCloudMode();
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
    if (name.length > 100) {
      setNameError("Name must be 100 characters or less");
      return false;
    }
    if (!IS_CLOUD && !projectDir) {
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

      {/* Website URL */}
      <div className="space-y-2">
        <Label htmlFor="website-url" className="text-sm font-medium">
          Website URL{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="website-url"
          type="url"
          value={config.websiteUrl}
          onChange={(e) => updateConfig({ websiteUrl: e.target.value })}
          placeholder="https://yourcompany.com"
          className="bg-muted/50"
        />
        {!IS_CLOUD && (
          <p className="text-xs text-muted-foreground">
            We&apos;ll import your website content when you launch.
          </p>
        )}
      </div>

      {/* Project folder (local mode only) */}
      {!IS_CLOUD && (
        <div className="space-y-2">
          <Label htmlFor="project-dir" className="text-sm font-medium">
            Project Folder
          </Label>
          <FolderInput
            id="project-dir"
            value={config.projectDir}
            onChange={(val) => {
              updateConfig({ projectDir: val });
              if (pathError) setPathError(null);
            }}
            autoSuggestBase={config.companyName}
            className="bg-muted/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNext();
            }}
          />
          {pathError ? (
            <p className="text-xs text-destructive">{pathError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Browse for a folder or type a full path. We will create the business
              there.
            </p>
          )}
        </div>
      )}

      {/* Document upload (local mode only) */}
      {!IS_CLOUD && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Upload Documents{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Share existing materials so your AI team can learn about your business.
          </p>
          <FileDropzone files={files} onChange={onFilesChange} />
        </div>
      )}

      {/* Next button */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleNext}>Next: About Your Business</Button>
      </div>
    </div>
  );
}
