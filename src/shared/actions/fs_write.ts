// Action: fs_write — write within a bounded directory.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface FsWriteInput {
  relativePath: string;
  content: string;
  /** Default 'overwrite'. */
  mode?: 'overwrite' | 'append';
}

export interface FsWriteResult {
  resolvedPath: string;
  bytesWritten: number;
}

export interface FsWriter {
  write(input: FsWriteInput): Promise<FsWriteResult>;
  mkdir(relativeDir: string): Promise<void>;
}

export function createFsWriter(rootDir: string): FsWriter {
  const root = path.resolve(rootDir);
  return {
    async write(input) {
      const resolved = path.resolve(root, input.relativePath);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new Error(`fs_write: path escapes bounded root (${input.relativePath})`);
      }
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      const buf = Buffer.from(input.content, 'utf-8');
      if (input.mode === 'append') await fs.appendFile(resolved, buf);
      else await fs.writeFile(resolved, buf);
      return { resolvedPath: resolved, bytesWritten: buf.byteLength };
    },
    async mkdir(relativeDir) {
      const resolved = path.resolve(root, relativeDir);
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new Error(`fs_write: mkdir path escapes bounded root (${relativeDir})`);
      }
      await fs.mkdir(resolved, { recursive: true });
    },
  };
}
