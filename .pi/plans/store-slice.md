# Credential store — library-backed adapter

## Selected composition

- **Pi CredentialStore:** target interface.
- **lowdb Low<T> + DataFile<T>:** typed in-memory collection, file I/O, serialization hooks, atomic replacement.
- **proper-lockfile:** already installed; supplies the missing cross-process exclusion.
- **Valibot:** credential-document decoding with preserved OAuth extension fields.
- **ts-extras:** typed object iteration; already installed.

## Files

```text
src/store/
├── index.ts       # Pi CredentialStore adapter; complete read/list/modify/delete
├── file.ts        # lowdb construction, fresh reads, lock lifetime, file permissions
└── schema.ts      # decode JSON credentials and encode their Map representation
```

Provider and plugin files remain unchanged. Dependencies may be added; Bunup, TypeScript configuration, existing manifest settings and package exports stay unchanged.

## Native library-backed shape

```ts
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';
import type { Low } from 'lowdb';

type Credentials = Map<string, Credential>;
type UpdateCredential = Parameters<CredentialStore['modify']>[1];
type OperationOptions = Parameters<CredentialStore['read']>[1];

type FileOperation<TResult> = (
  database: Low<Credentials>,
) => Promise<TResult>;

class CredentialStoreAdapter implements CredentialStore {
  constructor(private readonly file: CredentialFile) {}

  readonly modify: CredentialStore['modify'] = (providerId, update, options) =>
    this.file.exclusive(
      database => applyCredentialUpdate(database, providerId, update),
      options,
    );

  // read/list/delete translate directly to the native Map and lowdb operations.
  // No document class, dirty flag, commit descriptor, or provider registry.
}

async function applyCredentialUpdate(
  database: Low<Credentials>,
  providerId: string,
  update: UpdateCredential,
): ReturnType<CredentialStore['modify']> {
  const current = database.data.get(providerId);
  const next = await update(current);

  if (next === undefined) return current;

  await database.update(credentials => {
    credentials.set(providerId, next);
  });

  return next;
}
```

`applyCredentialUpdate` is the actual adaptation: Pi awaits an asynchronous updater and returns its result; lowdb's update callback is synchronous and returns no result. Await the Pi updater first, then pass a synchronous mutation to lowdb. Do not pass an async callback into lowdb.update.

## File module

```ts
import { Low } from 'lowdb';
import { DataFile } from 'lowdb/node';

const adapter = new DataFile<Credentials>(path, {
  parse: decodeCredentials,
  stringify: encodeCredentials,
});

const database = new Low(adapter, new Map<string, Credential>());
```

`CredentialFile.exclusive<TResult>(operation: FileOperation<TResult>, options?: OperationOptions): Promise<TResult>` owns locking, construction of a fresh database snapshot, reading, cancellation checkpoints, operation execution, and release. All mutations, including deletion, use this one ownership point. Initialization and file permissions live here, not in credential methods.

Genuine generic relationship: the callback receives Low<Credentials> and determines the exact returned TResult. Pi modification returns Credential | undefined, deletion returns void, and metadata enumeration returns CredentialInfo[]. The Map value type also flows through DataFile and Low, keeping the decoder, mutations and writer consistent.

## Translation map

| Pi operation | Library operation |
|---|---|
| read(id) | Fresh lowdb read, Map.get(id); absent becomes undefined |
| list() | Map entries mapped to providerId/type metadata |
| modify(id, updater) | Await updater, synchronous lowdb.update mutation, return saved/current credential |
| delete(id) | Locked lowdb.update with Map.delete(id) |

The file remains Pi-compatible JSON keyed by provider ID; Map is only the in-memory representation. OAuth fields such as clientId and scopes survive decoding and encoding.

## Alternatives

| Route | Consequence |
|---|---|
| **lowdb adapter — proposed** | Native generic file adapters and mutation API; local code translates Pi callback semantics and supplies locking. |
| Conf adapter | Native typed get/set/delete and atomic writes; broader configuration behavior, still needs the same lock boundary. |
| Focused JSON read/write libraries | Fewer database concepts; more local collection and persistence composition. |

## References

- [Pi credential contract](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/auth/types.ts)
- [lowdb Low implementation](https://github.com/typicode/lowdb/blob/main/src/core/Low.ts): update invokes the callback without awaiting it, then writes; it is not a transaction.
- [lowdb DataFile](https://github.com/typicode/lowdb/blob/main/src/adapters/node/DataFile.ts): parse/stringify adapter hooks.
- [lowdb TextFile](https://github.com/typicode/lowdb/blob/main/src/adapters/node/TextFile.ts): asynchronous writes delegate to steno.
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile): exclusion and release API.
- [Conf](https://github.com/sindresorhus/conf): atomic writes, but explicitly no overlapping multi-process writes.

Estimated implementation: 45–60 minutes. Deliver the entire store module, not just its factory.
