import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AuthContext, OAuthCredential } from '@earendil-works/pi-ai';

const roots: string[] = [];

export const testCredential: OAuthCredential = {
  type: 'oauth',
  access: 'access-token',
  refresh: 'refresh-token',
  expires: Number.MAX_SAFE_INTEGER,
  clientId: 'client',
};

export const authContext: AuthContext = {
  env: async () => {},
  fileExists: async () => false,
};

export async function temporaryAuthPath(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'flue-oauth-'));
  roots.push(root);
  const directory = path.join(root, 'config');
  await mkdir(directory, { recursive: true });
  return path.join(directory, 'auth.json');
}

export async function cleanupTemporaryRoots(): Promise<void> {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}
