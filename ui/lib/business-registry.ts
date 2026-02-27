import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BusinessRegistryEntry {
  id: string;
  name: string;
  projectDir: string;
  template: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface BusinessRegistry {
  version: number;
  activeBusinessId: string | null;
  businesses: BusinessRegistryEntry[];
}

const REGISTRY_VERSION = 1;
const REGISTRY_DIR = path.join(os.homedir(), ".aicib");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "businesses.json");

function nowIso(): string {
  return new Date().toISOString();
}

function ensureRegistryDir(): void {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
}

function normalizeProjectDir(projectDir: string): string {
  return path.resolve(projectDir.trim());
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseConfigMetadata(projectDir: string): { name: string; template: string } {
  const configPath = path.join(projectDir, "aicib.config.yaml");
  if (!fs.existsSync(configPath)) {
    return {
      name: path.basename(projectDir) || "Business",
      template: "saas-startup",
    };
  }

  const raw = fs.readFileSync(configPath, "utf-8");

  const companyBlock = raw.match(/^company:\s*\n((?:\s{2}.*\n?)*)/m)?.[1] ?? "";
  const companyNameFromBlock = companyBlock.match(/^\s*name:\s*(.+)$/m)?.[1];
  const templateFromBlock = companyBlock.match(/^\s*template:\s*(.+)$/m)?.[1];

  const name = stripQuotes(
    companyNameFromBlock || raw.match(/^name:\s*(.+)$/m)?.[1] || path.basename(projectDir)
  );
  const template = stripQuotes(
    templateFromBlock || raw.match(/^template:\s*(.+)$/m)?.[1] || "saas-startup"
  );

  return { name, template };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "business";
}

function createBusinessId(name: string): string {
  return `${slugify(name)}-${Date.now().toString(36)}`;
}

function walkUpForConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "aicib.config.yaml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return null;
}

function defaultRegistry(): BusinessRegistry {
  return {
    version: REGISTRY_VERSION,
    activeBusinessId: null,
    businesses: [],
  };
}

function coerceRegistry(raw: unknown): BusinessRegistry {
  if (!raw || typeof raw !== "object") {
    return defaultRegistry();
  }

  const source = raw as {
    version?: unknown;
    activeBusinessId?: unknown;
    businesses?: unknown[];
  };

  const businesses = Array.isArray(source.businesses)
    ? source.businesses
        .filter((item) => !!item && typeof item === "object")
        .map((item) => {
          const row = item as Record<string, unknown>;
          const rawProjectDir =
            typeof row.projectDir === "string" ? row.projectDir : "";
          if (!rawProjectDir.trim()) return null;

          const normalizedDir = normalizeProjectDir(rawProjectDir);
          const createdAt =
            typeof row.createdAt === "string" ? row.createdAt : nowIso();
          const lastOpenedAt =
            typeof row.lastOpenedAt === "string"
              ? row.lastOpenedAt
              : createdAt;
          const name =
            typeof row.name === "string" && row.name.trim()
              ? row.name.trim()
              : path.basename(normalizedDir) || "Business";
          const template =
            typeof row.template === "string" && row.template.trim()
              ? row.template.trim()
              : "saas-startup";
          const id =
            typeof row.id === "string" && row.id.trim()
              ? row.id.trim()
              : createBusinessId(name);

          return {
            id,
            name,
            projectDir: normalizedDir,
            template,
            createdAt,
            lastOpenedAt,
          } satisfies BusinessRegistryEntry;
        })
        .filter((item): item is BusinessRegistryEntry => !!item)
    : [];

  const deduped: BusinessRegistryEntry[] = [];
  const seenDirs = new Set<string>();
  for (const business of businesses) {
    const key = business.projectDir.toLowerCase();
    if (seenDirs.has(key)) continue;
    seenDirs.add(key);
    deduped.push(business);
  }

  let activeBusinessId =
    typeof source.activeBusinessId === "string" ? source.activeBusinessId : null;
  if (activeBusinessId && !deduped.some((business) => business.id === activeBusinessId)) {
    activeBusinessId = deduped[0]?.id ?? null;
  }
  if (!activeBusinessId && deduped.length > 0) {
    activeBusinessId = deduped[0].id;
  }

  return {
    version: REGISTRY_VERSION,
    activeBusinessId,
    businesses: deduped,
  };
}

function bootstrapLegacyBusiness(): BusinessRegistry {
  const envDir = process.env.AICIB_PROJECT_DIR;
  const detectedDir =
    envDir && fs.existsSync(path.join(envDir, "aicib.config.yaml"))
      ? envDir
      : walkUpForConfig(process.cwd());

  if (!detectedDir) {
    return defaultRegistry();
  }

  const projectDir = normalizeProjectDir(detectedDir);
  const metadata = parseConfigMetadata(projectDir);
  const createdAt = nowIso();
  const business: BusinessRegistryEntry = {
    id: createBusinessId(metadata.name),
    name: metadata.name,
    projectDir,
    template: metadata.template,
    createdAt,
    lastOpenedAt: createdAt,
  };

  return {
    version: REGISTRY_VERSION,
    activeBusinessId: business.id,
    businesses: [business],
  };
}

function saveRegistry(registry: BusinessRegistry): void {
  ensureRegistryDir();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
}

export function getBusinessRegistryPath(): string {
  return REGISTRY_PATH;
}

export function readBusinessRegistry(): BusinessRegistry {
  ensureRegistryDir();

  if (!fs.existsSync(REGISTRY_PATH)) {
    const seeded = bootstrapLegacyBusiness();
    saveRegistry(seeded);
    return seeded;
  }

  try {
    const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
    const parsed = raw.trim() ? JSON.parse(raw) : defaultRegistry();
    const registry = coerceRegistry(parsed);
    saveRegistry(registry);
    return registry;
  } catch {
    const fallback = defaultRegistry();
    saveRegistry(fallback);
    return fallback;
  }
}

export function writeBusinessRegistry(registry: BusinessRegistry): BusinessRegistry {
  const normalized = coerceRegistry(registry);
  saveRegistry(normalized);
  return normalized;
}

export function listBusinesses(): BusinessRegistryEntry[] {
  return readBusinessRegistry().businesses;
}

export function getActiveBusiness(): BusinessRegistryEntry | null {
  const registry = readBusinessRegistry();
  if (!registry.activeBusinessId) return null;
  return registry.businesses.find((business) => business.id === registry.activeBusinessId) ?? null;
}

export function getBusinessById(businessId: string): BusinessRegistryEntry | null {
  const normalizedId = businessId.trim();
  if (!normalizedId) return null;
  return listBusinesses().find((business) => business.id === normalizedId) ?? null;
}

export function setActiveBusiness(businessId: string): BusinessRegistryEntry | null {
  const registry = readBusinessRegistry();
  const target = registry.businesses.find((business) => business.id === businessId.trim());
  if (!target) return null;

  const touched = registry.businesses.map((business) =>
    business.id === target.id
      ? { ...business, lastOpenedAt: nowIso() }
      : business
  );

  writeBusinessRegistry({
    ...registry,
    activeBusinessId: target.id,
    businesses: touched,
  });

  return touched.find((business) => business.id === target.id) ?? null;
}

export function upsertBusiness(input: {
  projectDir: string;
  name?: string;
  template?: string;
  setActive?: boolean;
}): BusinessRegistryEntry {
  const registry = readBusinessRegistry();
  const normalizedDir = normalizeProjectDir(input.projectDir);
  const dirKey = normalizedDir.toLowerCase();
  const index = registry.businesses.findIndex(
    (business) => business.projectDir.toLowerCase() === dirKey
  );
  const metadata = parseConfigMetadata(normalizedDir);
  const name = (input.name || metadata.name || path.basename(normalizedDir) || "Business").trim();
  const template = (input.template || metadata.template || "saas-startup").trim();

  let nextBusinesses: BusinessRegistryEntry[];
  let activeId = registry.activeBusinessId;
  let result: BusinessRegistryEntry;
  const touchedAt = nowIso();

  if (index >= 0) {
    const existing = registry.businesses[index];
    result = {
      ...existing,
      name,
      template,
      projectDir: normalizedDir,
      lastOpenedAt: touchedAt,
    };

    nextBusinesses = registry.businesses.slice();
    nextBusinesses[index] = result;
  } else {
    result = {
      id: createBusinessId(name),
      name,
      template,
      projectDir: normalizedDir,
      createdAt: touchedAt,
      lastOpenedAt: touchedAt,
    };
    nextBusinesses = [...registry.businesses, result];
  }

  if (input.setActive) {
    activeId = result.id;
  }

  writeBusinessRegistry({
    ...registry,
    activeBusinessId: activeId,
    businesses: nextBusinesses,
  });

  return result;
}
