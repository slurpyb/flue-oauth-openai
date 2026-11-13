// Live consumer check: no mocks, no tools, one submission, existing source OAuth.
import { strict as assert } from 'node:assert';
import { init, useModel } from '../../../agentcn/app/node_modules/@flue/runtime/dist/index.mjs';
import { start } from '../../../agentcn/app/node_modules/@flue/runtime/dist/node/index.mjs';
import { configureOpenAI } from '../../../agentcn/app/src/openai.ts';

const started = Date.now();
const deadline = setTimeout(() => {
  console.error('FAIL: live verification exceeded 90 seconds');
  process.exit(124);
}, 90_000);

function OAuthVerification() {
  useModel('openai/gpt-6.1-sol', { thinkingLevel: 'low' });
  return 'Follow the user instruction exactly. Do not use tools.';
}
OAuthVerification.durability = { maxAttempts: 1, timeoutMs: 60_000 };

try {
  await using runtime = await start({ agents: [OAuthVerification], providers: [] });
  console.log('Runtime started; registering source OAuth provider.');
  await configureOpenAI();
  console.log('Source OAuth provider registered; dispatching one real request.');
  const session = init(OAuthVerification);
  const receipt = await session.dispatch('Reply with exactly: OAUTH_SOURCE_VERIFIED');
  const reply = await session.read(receipt);
  assert.equal(reply.text.trim(), 'OAUTH_SOURCE_VERIFIED');
  console.log(JSON.stringify({ result: 'PASS', output: reply.text, elapsedMs: Date.now() - started }));
} catch (error) {
  // Avoid dumping provider request objects, headers, or credential-bearing causes.
  console.error(JSON.stringify({ result: 'FAIL', name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : 'Non-Error rejection', elapsedMs: Date.now() - started }));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
}
