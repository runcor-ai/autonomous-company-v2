// Sense: fs_read — read files within a bounded directory.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface FsReadInput {
  /** Path relative to the bounded root. Cannot escape via .. */
  relativePath: string;
  /** Maximum bytes to read. */
  maxBytes?: number;
}

export interface FsReadResult {
  resolvedPath: string;
  content: string;
  truncated: boolean;
  byteCount: number;
}

const DEFAULT_MAX_BYTES = 256_000;

export interface FsReader {
  read(input: FsReadInput): Promise<FsReadResult>;
  list(relativeDir: string): Promise<string[]>;
}

export function createFsReader(rootDir: string): FsReader {
  const root = path.resolve(rootDir);
  return {
    async read(input) {
      const resolved = path.resolve(root, input.relativePath);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new Error(`fs_read: path escapes bounded root (${input.relativePath})`);
      }
      const buf = await fs.readFile(resolved);
      const max = input.maxBytes ?? DEFAULT_MAX_BYTES;
      const truncated = buf.byteLength > max;
      const content = truncated ? buf.subarray(0, max).toString('utf-8') : buf.toString('utf-8');
      return { resolvedPath: resolved, content, truncated, byteCount: buf.byteLength };
    },
    async list(relativeDir) {
      const resolved = path.resolve(root, relativeDir);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new Error(`fs_read: list path escapes bounded root (${relativeDir})`);
      }
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      return entries.map((e) => e.isDirectory() ? `${e.name}/` : e.name);
    },
  };
}
