import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Provider } from '@earendil-works/pi-ai';
import { setProvider } from '@flue/runtime';
import type { Plugin } from 'vite';
import { authorize } from './openai/subscription.ts';

const cacheKey = Symbol.for('agentcn.openai.subscription.authorization');
const globals = globalThis as typeof globalThis & {
  [cacheKey]?: Map<string, Promise<Provider>>;
};
const authorizations = (globals[cacheKey] ??= new Map<
  string,
  Promise<Provider>
>());

export function openAIAuthPlugin(): Plugin {
  return {
    name: 'agentcn-openai-subscription-auth',
    apply: 'serve',
    async configureServer() {
      await authorization(true);
    },
  };
}

export async function configureOpenAI(): Promise<void> {
  setProvider(await authorization(false));
}

function authorization(isInteractive: boolean): Promise<Provider> {
  const path = resolve(
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
      'agentcn',
      'auth.json',
    ),
  );
  const existing = authorizations.get(path);
  if (existing) return existing;

  const pending = runAuthorization(path, isInteractive).catch((error) => {
    authorizations.delete(path);
    throw error;
  });
  authorizations.set(path, pending);
  return pending;
}

async function runAuthorization(
  path: string,
  isInteractive: boolean,
): Promise<Provider> {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new Error('OpenAI authorization canceled.'));
  process.once('SIGINT', cancel);
  try {
    return await authorize({
      path,
      interactive: isInteractive,
      signal: controller.signal,
    });
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}
