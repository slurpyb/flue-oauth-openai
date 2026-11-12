import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { AuthEvent, AuthInteraction } from '@earendil-works/pi-ai';

export async function shouldAuthorize(
  isInteractive: boolean,
  signal: AbortSignal,
): Promise<boolean> {
  if (!isInteractive) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const answer = await prompt(
    'Would you like to authorize with OpenAI/ChatGPT subscription? [y/N] ',
    signal,
  );
  return /^y(es)?$/i.test(answer.trim());
}

export function createLoginInteraction(signal: AbortSignal): AuthInteraction {
  return {
    signal,
    prompt: (request) =>
      prompt(
        `${request.message} `,
        request.signal ? AbortSignal.any([signal, request.signal]) : signal,
      ),
    notify: notifyAuthEvent,
  };
}

async function prompt(message: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const cancel = () => terminal.close();
  let onClose: () => void = () => {};
  const closed = new Promise<never>((_, reject) => {
    onClose = () => reject(new Error('OpenAI authorization canceled.'));
    terminal.once('close', onClose);
  });
  terminal.once('SIGINT', cancel);
  try {
    return await Promise.race([terminal.question(message, { signal }), closed]);
  } finally {
    terminal.removeListener('close', onClose);
    terminal.removeListener('SIGINT', cancel);
    terminal.close();
  }
}

function notifyAuthEvent(event: AuthEvent): void {
  switch (event.type) {
    case 'auth_url':
      if (event.instructions) console.log(event.instructions);
      openBrowser(event.url);
      return;
    case 'info':
    case 'progress':
      console.log(event.message);
  }
}

function browserCommand(url: string): [string, string[]] {
  switch (process.platform) {
    case 'darwin':
      return ['open', [url]];
    case 'win32':
      return ['rundll32', ['url.dll,FileProtocolHandler', url]];
    default:
      return ['xdg-open', [url]];
  }
}

function openBrowser(url: string): void {
  const [command, arguments_] = browserCommand(url);
  const fallback = () => console.log(`Open this URL to authorize: ${url}`);
  try {
    execFile(command, arguments_, (error) => {
      if (error) fallback();
    });
  } catch {
    fallback();
  }
}
