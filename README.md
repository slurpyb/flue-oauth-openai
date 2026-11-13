# flue-oauth-openai

OpenAI/ChatGPT subscription sign-in for [Flue](https://flueframework.com) agents.

Flue ships pi's provider protocol but no OAuth adapters. This package supplies one: it stores credentials in an XDG file, drives the browser/manual-code sign-in flow, and registers a provider whose auth resolves per request.

## Install

```bash
bun add flue-oauth-openai @earendil-works/pi-ai @flue/runtime
```

Node.js only (uses `node:fs`, `node:http`, and the process TTY).

## Usage

Register before any agent runs. `configureOpenAI()` authorizes when there is no usable credential and then calls `setProvider()`:

```ts title="src/app.ts"
import { configureOpenAI } from 'flue-oauth-openai';

await configureOpenAI();
```

`flue run` never loads `app.ts`, so put the same call in the agent module it does load:

```ts title="src/agents/assistant.ts"
import { configureOpenAI } from 'flue-oauth-openai';

await configureOpenAI();

export function Assistant() {
  useModel('openai/gpt-5');
  return '…';
}
```

### Vite dev server

Authorize while the dev server starts instead of on the first request:

```ts title="vite.config.ts"
import { openAIAuthPlugin } from 'flue-oauth-openai';

export default defineConfig({
  plugins: [flue(), openAIAuthPlugin()],
});
```

### Without a terminal

Set `interactive: false` to make a missing credential fail with `NotAuthorizedError` instead of prompting. Sign in once from a TTY with the same package, then reuse the credential file.

## Options

```ts
type OpenAIOptions = {
  authPath?: string; // default: $XDG_CONFIG_HOME/flue-oauth/auth.json
  agentName?: string; // default: flue-oauth
  interactive?: boolean; // default: stdin and stdout are a TTY
  signal?: AbortSignal;
};
```

## Credential file

`$XDG_CONFIG_HOME/flue-oauth/auth.json` (mode `0600`), or `~/.config/flue-oauth/auth.json`:

```json
{
  "version": 1,
  "deviceId": "…",
  "credentials": {
    "openai": { "type": "oauth", "refresh": "…", "access": "…", "expires": 0, "clientId": "…" }
  }
}
```

Writes are atomic and serialized across processes. Pre-1.0 flat files (`{ "deviceId": …, "openai": … }`) are read and rewritten in the versioned shape.

## Errors

| Error | Meaning |
|---|---|
| `NotAuthorizedError` | No usable credential and the sign-in prompt cannot run. |
| `AuthStoreError` | The credential file is unreadable, corrupt, or locked. Delete it and sign in again. |

## Notes

- Access tokens refresh per request through a private pi `Models` collection; Flue's registry only ever sees the resolved token, so refresh stays locked and cross-process safe.
- Classifier models are hidden: subscription tokens cannot reach that API.
- Persistence (`db.ts`) is not part of this package: Flue discovers it in your project source root.

## License

MIT
