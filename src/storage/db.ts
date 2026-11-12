/* oxlint-disable unicorn-js/name-replacements -- Flue discovers db.ts by convention. */
import type { PersistenceAdapter } from '@flue/runtime/adapter';
import { sqlite } from '@flue/runtime/node';
import { isAbsolute } from 'node:path';

const path =
  process.env.AGENTCN_FLUE_DB || import.meta.env.AGENTCN_DEFAULT_FLUE_DB;
if (!path || !isAbsolute(path))
  throw new Error('AGENTCN_FLUE_DB must be an absolute file path.');
const database: PersistenceAdapter = sqlite(path);
export default database;
