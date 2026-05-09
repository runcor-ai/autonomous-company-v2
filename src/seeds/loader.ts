// Seed loader — reads an R++ seed file from `seeds/<role>.rpp` and extracts the named
// blocks the SeedLayer + capability filter consume.
//
// Format is intentionally minimal pending the full rpp-parser: each block is
// `BLOCKNAME:\n<content>` and ends at the next `BLOCKNAME:` (top-level, capitalized) or EOF.
// Inside a block, content is preserved verbatim (whitespace, hyphens, newlines).
//
// Recognized blocks:
//   TARGET     — short identifier (e.g. "ceo"). Used in logs and the SeedLayer header.
//   PERSONA    — role identity prose. Rendered into the prompt stack as the role's first-person.
//   TOOLS      — one bare tool name per line (with optional leading "- "). Filters the
//                CapabilitiesLayer so the agent ONLY sees these tools.
//   BEHAVIOR   — bulleted operating rules. Rendered after PERSONA.
//   CHECKLIST  — done criteria. Rendered after BEHAVIOR.
//
// If the file doesn't exist or AGENT_SEED is unset, returns null and V2 falls back to the
// void-seed mode (the original "You exist. What do you do?" prompt).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface SeedSpec {
  /** Source identifier — typically the basename without extension (e.g. "ceo"). */
  name: string;
  /** TARGET block contents (or `name` if missing). */
  target: string;
  /** PERSONA block — the role's identity prose. Empty string if missing. */
  persona: string;
  /** TOOLS block — set of allowed bare tool names (e.g. "inbox_read"). Empty set = no filter. */
  allowedTools: Set<string>;
  /** BEHAVIOR block — operating rules verbatim. */
  behavior: string;
  /** CHECKLIST block — done criteria verbatim. */
  checklist: string;
  /** Resolved absolute path of the file, for logging. */
  sourcePath: string;
}

const BLOCK_HEADER = /^([A-Z][A-Z_]*):\s*(.*)$/;

function extractBlocks(content: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  let currentName: string | null = null;
  let currentLines: string[] = [];
  for (const line of lines) {
    const m = line.match(BLOCK_HEADER);
    if (m) {
      if (currentName !== null) {
        blocks.set(currentName, currentLines.join('\n').trim());
      }
      currentName = m[1] ?? null;
      currentLines = m[2] ? [m[2]] : [];
    } else if (currentName !== null) {
      currentLines.push(line);
    }
  }
  if (currentName !== null) {
    blocks.set(currentName, currentLines.join('\n').trim());
  }
  return blocks;
}

function parseToolList(toolsBlock: string): Set<string> {
  const tools = new Set<string>();
  for (const raw of toolsBlock.split('\n')) {
    const line = raw.replace(/^\s*-?\s*/, '').trim();
    if (line && !line.startsWith('#')) tools.add(line);
  }
  return tools;
}

/**
 * Resolve a seed name to an absolute path. Conventions:
 *   - bare name "ceo"  → <repo>/seeds/ceo.rpp
 *   - relative path    → resolved from cwd
 *   - absolute path    → used as-is
 */
function resolveSeedPath(seedName: string): string {
  if (path.isAbsolute(seedName)) return seedName;
  if (seedName.includes('/') || seedName.includes('\\') || seedName.endsWith('.rpp')) {
    return path.resolve(process.cwd(), seedName);
  }
  return path.resolve(process.cwd(), 'seeds', `${seedName}.rpp`);
}

export function loadSeed(seedName: string | undefined | null): SeedSpec | null {
  if (!seedName) return null;
  const sourcePath = resolveSeedPath(seedName);
  if (!existsSync(sourcePath)) {
    // eslint-disable-next-line no-console
    console.warn(`[seed] AGENT_SEED=${seedName} but file not found: ${sourcePath} — falling back to void seed`);
    return null;
  }
  const raw = readFileSync(sourcePath, 'utf-8');
  const blocks = extractBlocks(raw);
  const target = blocks.get('TARGET') ?? seedName;
  const persona = blocks.get('PERSONA') ?? '';
  const behavior = blocks.get('BEHAVIOR') ?? '';
  const checklist = blocks.get('CHECKLIST') ?? '';
  const toolsBlock = blocks.get('TOOLS') ?? '';
  const allowedTools = parseToolList(toolsBlock);
  return {
    name: path.basename(sourcePath).replace(/\.rpp$/i, ''),
    target,
    persona,
    allowedTools,
    behavior,
    checklist,
    sourcePath,
  };
}
