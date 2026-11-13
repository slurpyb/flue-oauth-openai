import { afterEach, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { isModelType } from '@earendil-works/pi-ai';
import { authorize, NotAuthorizedError } from '../src/auth/subscription';
import { openaiSubscriptionProvider } from '../src/provider/openai';
import { AuthStoreError, createCredentialStore } from '../src/storage';
import {
  authContext,
  cleanupTemporaryRoots,
  temporaryAuthPath,
  testCredential,
} from './helpers';

afterEach(cleanupTemporaryRoots);

const signal = new AbortController().signal;

test('subscription provider withholds classifier models', () => {
  const provider = openaiSubscriptionProvider();
  const all = provider.getAllModels?.() ?? provider.getModels();
  const visible = provider.filterAllModels?.(all, undefined) ?? all;

  expect(all.some((model) => isModelType(model, 'classifier'))).toBe(true);
  expect(visible.some((model) => isModelType(model, 'classifier'))).toBe(false);
});

test('stored credential resolves through the provider', async () => {
  const path = await temporaryAuthPath();
  await createCredentialStore(path).modify('openai', async () => testCredential);

  const provider = await authorize({
    provider: openaiSubscriptionProvider(),
    path,
    interactive: false,
    signal,
  });

  expect(provider.auth.oauth).toBeUndefined();
  const resolve = provider.auth.apiKey?.resolve;
  expect(resolve).toBeDefined();

  const result = await resolve?.({
    ctx: authContext,
    credential: undefined,
    signal,
  });
  expect(result?.auth.apiKey).toBe(testCredential.access);
});

test('missing credential throws when authorization cannot prompt', async () => {
  await expect(
    authorize({
      provider: openaiSubscriptionProvider(),
      path: await temporaryAuthPath(),
      interactive: false,
      signal,
    }),
  ).rejects.toBeInstanceOf(NotAuthorizedError);
});

test('corrupt store surfaces as AuthStoreError', async () => {
  const path = await temporaryAuthPath();
  await writeFile(path, 'not json');

  await expect(
    authorize({
      provider: openaiSubscriptionProvider(),
      path,
      interactive: false,
      signal,
    }),
  ).rejects.toBeInstanceOf(AuthStoreError);
});
