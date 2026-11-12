import { createModels, type Provider } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import {
  createCredentialStore,
  getOrCreateDeviceId,
  readAuth,
} from './storage.ts';
import { shouldAuthorize, createLoginInteraction } from './terminal.ts';

type Models = ReturnType<typeof createModels>;
type AuthorizationOptions = {
  path: string;
  interactive: boolean;
  signal: AbortSignal;
};
const missingAuth =
  'OpenAI/ChatGPT subscription authorization is required. Run the Vite development server in an interactive terminal to authorize.';

export async function authorize({
  path,
  interactive,
  signal,
}: AuthorizationOptions): Promise<Provider> {
  // Storage failures must not be mistaken for missing or expired credentials.
  await readAuth(path);
  const original = openaiProvider();
  const models = createSubscriptionModels(path, original);

  if (await hasSubscription(models, signal))
    return subscriptionProvider(original, models);
  if (!(await shouldAuthorize(interactive, signal)))
    throw new Error(missingAuth);

  await login({ models, path, signal });
  return subscriptionProvider(original, models);
}

function createSubscriptionModels(path: string, original: Provider): Models {
  const models = createModels({ credentials: createCredentialStore(path) });
  models.setProvider({ ...original, auth: { oauth: original.auth.oauth } });
  return models;
}

async function hasSubscription(
  models: Models,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    return Boolean(
      await models.getAuth('openai', {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      }),
    );
  } catch (error) {
    signal.throwIfAborted();
    if (!isRecoverableAuthError(error)) throw error;
    return false;
  }
}

function isRecoverableAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const authError = error as { code?: string; name?: string };
  return authError.code === 'oauth' || authError.name === 'TimeoutError';
}

async function login({
  models,
  path,
  signal,
}: {
  models: Models;
  path: string;
  signal: AbortSignal;
}): Promise<void> {
  const deviceId = await getOrCreateDeviceId(path, signal);
  await models.login('openai', 'oauth', createLoginInteraction(signal), {
    agentName: 'agentcn',
    getDeviceId: () => deviceId,
  });
}

function subscriptionProvider(original: Provider, models: Models): Provider {
  // Flue owns a separate Models collection; keep refresh in our OAuth-only collection.
  return {
    ...original,
    auth: {
      apiKey: {
        name: 'OpenAI/ChatGPT subscription',
        resolve: ({ signal }) => resolveSubscriptionAuth(models, signal),
      },
    },
  };
}

async function resolveSubscriptionAuth(models: Models, signal?: AbortSignal) {
  const result = await models.getAuth('openai', { signal });
  if (!result) throw new Error(missingAuth);
  return result;
}
