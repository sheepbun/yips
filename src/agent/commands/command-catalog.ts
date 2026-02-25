import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CommandKind = "builtin" | "tool" | "skill";

export interface CommandDescriptor {
  name: string;
  description: string;
  kind: CommandKind;
  implemented: boolean;
}

export interface CommandCatalogOptions {
  projectRoot?: string;
}

interface CatalogEntry extends CommandDescriptor {
  priority: number;
}

const GENERIC_DESCRIPTIONS = new Set(["Tool command", "Markdown skill", "Command"]);

const RESTORED_COMMAND_DEFAULTS: ReadonlyArray<{
  name: string;
  description: string;
  kind: CommandKind;
}> = [
  { name: "backend", description: "Switch AI backends (llamacpp, claude)", kind: "builtin" },
  { name: "clear", description: "Clear context and start a new session", kind: "builtin" },
  { name: "dl", description: "Alias for /download", kind: "builtin" },
  { name: "download", description: "Open the interactive model downloader", kind: "builtin" },
  { name: "exit", description: "Exit Yips", kind: "builtin" },
  { name: "fetch", description: "Retrieve and display content from a URL", kind: "tool" },
  { name: "grab", description: "Read a file's content into context", kind: "tool" },
  { name: "help", description: "Show available commands and tips", kind: "skill" },
  { name: "memorize", description: "Save a fact to long-term memory", kind: "tool" },
  { name: "model", description: "Open the Model Manager or switch to a specific model", kind: "builtin" },
  { name: "new", description: "Start a new session", kind: "builtin" },
  { name: "nick", description: "Set a custom nickname for a model", kind: "builtin" },
  { name: "quit", description: "Exit Yips", kind: "builtin" },
  { name: "search", description: "Search the web (DuckDuckGo)", kind: "tool" },
  { name: "sessions", description: "Interactively select and load a session", kind: "builtin" },
  { name: "setup", description: "Configure external chat channels", kind: "builtin" },
  { name: "stream", description: "Toggle streaming responses", kind: "builtin" },
  { name: "tokens", description: "Show or set token counter mode and max", kind: "builtin" },
  { name: "update", description: "Check for newer Yips versions and upgrade guidance", kind: "builtin" },
  { name: "verbose", description: "Toggle verbose output", kind: "builtin" },
  { name: "vt", description: "Toggle the Virtual Terminal", kind: "tool" }
];

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, "").toLowerCase();
}

function isGenericDescription(description: string): boolean {
  const trimmed = description.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return GENERIC_DESCRIPTIONS.has(trimmed);
}

function normalizeDescription(description: string): string {
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : "Command";
}

function sortedDirectoryEntries(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function fileNames(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function fileBasename(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
}

function pickCommandFile(commandDir: string, commandDirName: string, extension: ".py" | ".md"): string | null {
  if (!existsSync(commandDir)) {
    return null;
  }

  const names = fileNames(commandDir);
  const extensionLower = extension.toLowerCase();
  const targetBase = commandDirName.toLowerCase();

  const exact = names.find((name) => {
    if (!name.toLowerCase().endsWith(extensionLower)) {
      return false;
    }
    return fileBasename(name).toLowerCase() === targetBase;
  });
  if (exact) {
    return join(commandDir, exact);
  }

  const fallback = names.find((name) => name.toLowerCase().endsWith(extensionLower));
  return fallback ? join(commandDir, fallback) : null;
}

function toNonEmptyTrimmedLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function descriptionFromLines(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (/^description\s*:/iu.test(line)) {
      const extracted = line.replace(/^description\s*:\s*/iu, "").trim();
      if (extracted.length > 0) {
        return extracted;
      }
    }
  }

  const first = lines[0];
  if (!first) {
    return null;
  }

  const split = first.split(" - ");
  if (split.length > 1) {
    const remainder = split.slice(1).join(" - ").trim();
    if (remainder.length > 0) {
      return remainder;
    }
  }

  return first;
}

function extractPythonDescription(contents: string): string | null {
  const docstringMatch = contents.match(
    /^\s*(?:#.*\r?\n|\s)*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/u
  );
  const docstring = docstringMatch?.[1] ?? docstringMatch?.[2];
  if (!docstring) {
    return null;
  }

  return descriptionFromLines(toNonEmptyTrimmedLines(docstring));
}

function extractMarkdownDescription(contents: string): string | null {
  const lines = toNonEmptyTrimmedLines(contents);
  if (lines.length === 0) {
    return null;
  }

  const first = lines[0];
  if (!first) {
    return null;
  }

  if (!first.startsWith("#")) {
    return first;
  }

  for (const line of lines.slice(1)) {
    if (line.startsWith("#") || line.startsWith("!") || line.startsWith("```")) {
      continue;
    }
    return line;
  }

  const heading = first.replace(/^#+\s*/u, "").trim();
  return heading.length > 0 ? heading : null;
}

function readTextSafely(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function discoverCommands(parentDir: string, parentKind: CommandKind): CatalogEntry[] {
  if (!existsSync(parentDir)) {
    return [];
  }

  const discovered: CatalogEntry[] = [];

  for (const commandDirName of sortedDirectoryEntries(parentDir)) {
    const commandName = normalizeCommandName(commandDirName);
    if (commandName.length === 0) {
      continue;
    }

    const commandDir = join(parentDir, commandDirName);
    const pythonPath = pickCommandFile(commandDir, commandDirName, ".py");
    const markdownPath = pickCommandFile(commandDir, commandDirName, ".md");

    let kind = parentKind;
    let description: string | null = null;
    let priority = 0;

    if (pythonPath) {
      const contents = readTextSafely(pythonPath);
      if (contents) {
        description = extractPythonDescription(contents);
      }
      kind = "tool";
      priority = description ? 2 : 0;
    } else if (markdownPath) {
      const contents = readTextSafely(markdownPath);
      if (contents) {
        description = extractMarkdownDescription(contents);
      }
      kind = "skill";
      priority = description ? 2 : 0;
    }

    discovered.push({
      name: commandName,
      description: normalizeDescription(description ?? "Command"),
      kind,
      implemented: false,
      priority
    });
  }

  return discovered;
}

function upsertCatalogEntry(catalog: Map<string, CatalogEntry>, candidate: CatalogEntry): void {
  const normalizedName = normalizeCommandName(candidate.name);
  if (normalizedName.length === 0) {
    return;
  }

  const normalizedCandidate: CatalogEntry = {
    ...candidate,
    name: normalizedName,
    description: normalizeDescription(candidate.description)
  };

  const existing = catalog.get(normalizedName);
  if (!existing) {
    catalog.set(normalizedName, normalizedCandidate);
    return;
  }

  const candidateGeneric = isGenericDescription(normalizedCandidate.description);
  const existingGeneric = isGenericDescription(existing.description);
  const shouldReplace =
    normalizedCandidate.priority > existing.priority ||
    (normalizedCandidate.priority === existing.priority && !candidateGeneric && existingGeneric);

  if (shouldReplace) {
    catalog.set(normalizedName, {
      ...normalizedCandidate,
      implemented: existing.implemented || normalizedCandidate.implemented
    });
    return;
  }

  catalog.set(normalizedName, {
    ...existing,
    implemented: existing.implemented || normalizedCandidate.implemented
  });
}

export function loadCommandCatalog(options: CommandCatalogOptions = {}): CommandDescriptor[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const catalog = new Map<string, CatalogEntry>();

  for (const descriptor of RESTORED_COMMAND_DEFAULTS) {
    upsertCatalogEntry(catalog, {
      ...descriptor,
      name: normalizeCommandName(descriptor.name),
      implemented: false,
      priority: 1
    });
  }

  const toolsDir = join(projectRoot, "commands", "tools");
  const skillsDir = join(projectRoot, "commands", "skills");

  for (const descriptor of discoverCommands(toolsDir, "tool")) {
    upsertCatalogEntry(catalog, descriptor);
  }
  for (const descriptor of discoverCommands(skillsDir, "skill")) {
    upsertCatalogEntry(catalog, descriptor);
  }

  return [...catalog.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      kind: descriptor.kind,
      implemented: descriptor.implemented
    }));
}
