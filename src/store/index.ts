import type { AuthOperationOptions, Credential, CredentialStore } from "@earendil-works/pi-ai";
import { Low, type Adapter } from "lowdb";
import { TextFile } from "lowdb/node";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import nodePath from "node:path";
import { setTimeout } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { isDefined, objectEntries, objectFromEntries, objectHasOwn } from "ts-extras";
import type { Promisable } from "type-fest";
import * as v from "valibot";
import { writeJsonFile } from "write-json-file";

// Only disk input needs validation. Loose credential objects retain fields
// owned by providers; the rest of the store works with Pi's native Credential.
const credentialDocument = v.pipe(
    v.unknown(),
    v.check((value) => !Array.isArray(value)),
    v.record(v.string(), v.variant("type", [
        v.looseObject({
            type: v.literal("api_key"),
            key: v.optional(v.string()),
            env: v.optional(v.record(v.string(), v.string())),
        }),
        v.looseObject({
            type: v.literal("oauth"),
            access: v.string(),
            refresh: v.string(),
            expires: v.pipe(v.number(), v.finite()),
        }),
    ])),
);

class FileCredentialStore implements CredentialStore {
    readonly #path: string;

    constructor(path: string) {
        this.#path = nodePath.resolve(path);
    }

    readonly read: CredentialStore["read"] = (providerId, options) =>
        this.exclusive((database) => database.data.get(providerId), options);

    readonly list: CredentialStore["list"] = (options) =>
        this.exclusive(
            (database) => Array.from(database.data, ([providerId, credential]) => ({
                providerId,
                type: credential.type,
            })),
            options,
        );

    readonly modify: CredentialStore["modify"] = (providerId, update, options) =>
        this.exclusive(async (database) => {
            const current = database.data.get(providerId);
            const next = await update(current);
            if (!isDefined(next)) { return current; }
            await database.update((credentials) => credentials.set(providerId, next));
            return next;
        }, options);

    readonly delete: CredentialStore["delete"] = (providerId, options) =>
        this.exclusive(async (database) => {
            if (!database.data.has(providerId)) { return; }
            await database.update((credentials) => credentials.delete(providerId));
        }, options);

    private async resolvePath(): Promise<string> {
        await mkdir(nodePath.dirname(this.#path), { recursive: true, mode: 0o700 });
        try {
            return await realpath(this.#path);
        } catch (error) {
            if (!objectHasOwn(error, "code") || error.code !== "ENOENT") { throw error; }
            const directory = await realpath(nodePath.dirname(this.#path));
            return nodePath.join(directory, nodePath.basename(this.#path));
        }
    }

    private createDatabase(path: string, assertActive: () => void): Low<Map<string, Credential>> {
        const reader = new TextFile(path);
        const adapter = {
            read: async () => {
                assertActive();
                const document = await reader.read();
                assertActive();
                // TextFile reserves null for ENOENT; JSON null must fail validation.
                return document === null
                    ? new Map<string, Credential>()
                    : new Map<string, Credential>(objectEntries(v.parse(credentialDocument, JSON.parse(document))));
            },
            write: async (credentials: Map<string, Credential>): Promise<void> => {
                assertActive();
                await writeJsonFile(path, objectFromEntries([...credentials]), {
                    mode: 0o600,
                    indent: 2,
                });
            },
        } satisfies Adapter<Map<string, Credential>>;

        return new Low(adapter, new Map<string, Credential>());
    }

    private async acquireLock(
        path: string,
        onCompromised: (error: Error) => void,
        signal?: AbortSignal,
    ): ReturnType<typeof lockfile.lock> {
        // proper-lockfile's built-in retries cannot be cancelled.
        for (let attempt = 0; ; attempt++) {
            signal?.throwIfAborted();
            try {
                return await lockfile.lock(path, {
                    realpath: false,
                    stale: 30_000,
                    onCompromised,
                });
            } catch (error) {
                signal?.throwIfAborted();
                if (!objectHasOwn(error, "code") || error.code !== "ELOCKED" || attempt >= 30) {
                    throw error;
                }
            }
            await setTimeout(Math.min(50 * 1.5 ** attempt, 1000), undefined, { signal });
        }
    }

    private async exclusive<TResult>(
        operation: (database: Low<Map<string, Credential>>) => Promisable<TResult>,
        options?: AuthOperationOptions,
    ): Promise<TResult> {
        options?.signal?.throwIfAborted();
        const path = await this.resolvePath();
        let compromised: Error | undefined;
        const assertActive = (): void => {
            options?.signal?.throwIfAborted();
            if (compromised) { throw compromised; }
        };
        const release = await this.acquireLock(path, (error) => {
            compromised = error;
        }, options?.signal);

        try {
            assertActive();
            const database = this.createDatabase(path, assertActive);
            await database.read();
            assertActive();
            const result = await operation(database);
            assertActive();
            return result;
        } finally {
            if (!compromised) { await release(); }
        }
    }
}

function defaultCredentialPath(): string {
    const directory = process.env.XDG_CONFIG_HOME || nodePath.join(homedir(), ".config");
    return nodePath.join(directory, "flue-oauth", "auth.json");
}

/**
Persistent Pi credentials. XDG determines the default; explicit paths override it.
File format, validation, cross-process locking and atomic writes stay private.
*/
export function createCredentialStore(path: string = defaultCredentialPath()): CredentialStore {
    return new FileCredentialStore(path);
}
