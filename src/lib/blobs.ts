import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export function blobDir(dataDir: string): string {
  return path.join(dataDir, 'files');
}

export function blobPath(dataDir: string, fileId: string): string {
  return path.join(blobDir(dataDir), fileId);
}

export async function ensureBlobDir(dataDir: string): Promise<void> {
  await mkdir(blobDir(dataDir), { recursive: true });
}
