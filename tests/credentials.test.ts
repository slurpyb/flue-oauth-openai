import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'bun:test';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  AuthStoreError,
  createCredentialStore,
  getOrCreateDeviceId,
  readAuth,
} from '../src/storage';
import {
  cleanupTemporaryRoots,
  temporaryAuthPath,
  testCredential,
} from './helpers';

afterEach(cleanupTemporaryRoots);

test('missing file reads as empty', async () => {
  expect(await readAuth(await temporaryAuthPath())).toEqual({
    version: 1,
    credentials: {},
  });
});

test('legacy flat file keeps its credential and is rewritten versioned', async () => {
  const path = await temporaryAuthPath();
  const deviceId = randomUUID();
  await writeFile(path, JSON.stringify({ deviceId, openai: testCredential }));

  const read = await readAuth(path);
  expect(read.deviceId).toBe(deviceId);
  expect(read.credentials.openai).toEqual(testCredential);

  await createCredentialStore(path).modify('openai', async () => testCredential);
  const raw = JSON.parse(await readFile(path, 'utf8'));
  expect(raw.version).toBe(1);
  expect(raw.credentials.openai).toEqual(testCredential);
  expect(raw.openai).toBeUndefined();
});

test('corrupt file is a store error, not "not signed in"', async () => {
  const path = await temporaryAuthPath();
  await writeFile(path, '{"credentials":');
  await expect(readAuth(path)).rejects.toBeInstanceOf(AuthStoreError);
});

test('malformed credential is a store error', async () => {
  const path = await temporaryAuthPath();
  await writeFile(
    path,
    JSON.stringify({ credentials: { openai: { type: 'oauth', access: '' } } }),
  );
  await expect(readAuth(path)).rejects.toBeInstanceOf(AuthStoreError);
});

test('store reads, lists, writes, and deletes', async () => {
  const path = await temporaryAuthPath();
  const store = createCredentialStore(path);

  expect(await store.read('openai')).toBeUndefined();
  expect(await store.list()).toEqual([]);

  await store.modify('openai', async () => testCredential);
  expect(await store.read('openai')).toEqual(testCredential);
  expect(await store.list()).toEqual([{ providerId: 'openai', type: 'oauth' }]);

  await store.delete('openai');
  expect(await store.read('openai')).toBeUndefined();
});

test('concurrent modifies do not lose updates', async () => {
  const path = await temporaryAuthPath();
  const store = createCredentialStore(path);
  const bumps = Array.from({ length: 6 }, () =>
    store.modify('openai', async (current) => ({
      ...testCredential,
      expires: (current?.type === 'oauth' ? current.expires : 0) + 1,
    })),
  );

  await Promise.all(bumps);
  const stored = await store.read('openai');
  expect(stored?.type === 'oauth' ? stored.expires : undefined).toBe(6);
});

test('device id is created once and survives writes', async () => {
  const path = await temporaryAuthPath();
  const signal = new AbortController().signal;
  const deviceId = await getOrCreateDeviceId(path, signal);

  expect(await getOrCreateDeviceId(path, signal)).toBe(deviceId);
  await createCredentialStore(path).modify('openai', async () => testCredential);
  const stored = await readAuth(path);
  expect(stored.deviceId).toBe(deviceId);
});

test.skipIf(process.platform === 'win32')(
  'credential file is private and leaves no temporaries',
  async () => {
    const path = await temporaryAuthPath();
    await createCredentialStore(path).modify('openai', async () => testCredential);

    const permissions = await stat(path);
    expect(permissions.mode & 0o777).toBe(0o600);
    expect(await readdir(nodePath.dirname(path))).toEqual(['auth.json']);
  },
);
