import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { CredentialStore, OAuthCredential } from '@earendil-works/pi-ai';
import lockfile from 'proper-lockfile';

type AuthFile = { deviceId?: string; openai?: OAuthCredential };
type StoreOptions = Parameters<CredentialStore['read']>[1];
type CredentialUpdater = Parameters<CredentialStore['modify']>[1];

function isCredential(value: unknown): value is OAuthCredential {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    item.type === 'oauth' &&
    typeof item.access === 'string' &&
    !!item.access &&
    typeof item.refresh === 'string' &&
    !!item.refresh &&
    typeof item.expires === 'number' &&
    Number.isFinite(item.expires) &&
    typeof item.clientId === 'string' &&
    !!item.clientId
  );
}

function decodeAuth(text: string): AuthFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object') return {};
  const item = data as Record<string, unknown>;
  return {
    deviceId:
      typeof item.deviceId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        item.deviceId,
      )
        ? item.deviceId
        : undefined,
    openai: isCredential(item.openai) ? item.openai : undefined,
  };
}

export async function readAuth(path: string): Promise<AuthFile> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  return decodeAuth(text);
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function writeAuth(
  path: string,
  data: AuthFile,
  signal?: AbortSignal,
): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
      signal,
    });
    signal?.throwIfAborted();
    await rename(temporary, path);
  } finally {
    await removeTemporaryFile(temporary);
  }
}

async function acquireAuthLock(
  path: string,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const deadline = Date.now() + 30_000;
  while (true) {
    signal?.throwIfAborted();
    try {
      return await lockfile.lock(path, { realpath: false });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ELOCKED' ||
        Date.now() >= deadline
      )
        throw error;
      await delay(100, undefined, { signal });
    }
  }
}

async function readCredential(
  path: string,
  id: string,
  options?: StoreOptions,
): ReturnType<CredentialStore['read']> {
  options?.signal?.throwIfAborted();
  if (id !== 'openai') return undefined;
  return (await readAuth(path)).openai;
}

async function listCredentials(
  path: string,
  options?: StoreOptions,
): ReturnType<CredentialStore['list']> {
  options?.signal?.throwIfAborted();
  if (!(await readAuth(path)).openai) return [];
  return [{ providerId: 'openai', type: 'oauth' }];
}

async function modifyCredential(
  path: string,
  id: string,
  function_: CredentialUpdater,
  options?: StoreOptions,
): ReturnType<CredentialStore['modify']> {
  if (id !== 'openai')
    throw new Error('Only OpenAI subscription credentials are supported.');
  const signal = options?.signal;
  const release = await acquireAuthLock(path, signal);
  try {
    signal?.throwIfAborted();
    const data = await readAuth(path);
    const next = await function_(data.openai);
    signal?.throwIfAborted();
    if (next === undefined) return data.openai;
    if (!isCredential(next))
      throw new Error('Invalid OpenAI OAuth credential.');
    data.openai = next;
    await writeAuth(path, data, signal);
    return data.openai;
  } finally {
    await release();
  }
}

async function deleteCredential(
  path: string,
  id: string,
  options?: StoreOptions,
): ReturnType<CredentialStore['delete']> {
  if (id !== 'openai') return;
  const signal = options?.signal;
  const release = await acquireAuthLock(path, signal);
  try {
    signal?.throwIfAborted();
    const data = await readAuth(path);
    delete data.openai;
    await writeAuth(path, data, signal);
  } finally {
    await release();
  }
}

export function createCredentialStore(path: string): CredentialStore {
  return {
    read: (id, options) => readCredential(path, id, options),
    list: (options) => listCredentials(path, options),
    modify: (id, function_, options) =>
      modifyCredential(path, id, function_, options),
    delete: (id, options) => deleteCredential(path, id, options),
  };
}

export async function getOrCreateDeviceId(
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const release = await acquireAuthLock(path, signal);
  try {
    signal.throwIfAborted();
    const data = await readAuth(path);
    if (data.deviceId) return data.deviceId;
    data.deviceId = randomUUID();
    await writeAuth(path, data, signal);
    return data.deviceId;
  } finally {
    await release();
  }
}
