import type { CredentialStore } from "@earendil-works/pi-ai";
import { mkdir, realpath } from "node:fs/promises";
import nodePath from "node:path";
import { Low, type Adapter } from "lowdb";
import { JSONFile } from "lowdb/node";
import lockfile from "proper-lockfile";
import { isDefined, objectHasOwn } from "ts-extras";
import type { Promisable } from "type-fest";
import { writeJsonFile } from "write-json-file";
import {
    decodeCredentials,
    encodeCredentials,
    type CredentialDocument,
    type Credentials,
} from "./schema.ts";

type OperationOptions = Parameters<CredentialStore["read"]>[1];
type FileOperation<TResult> = (database: Low<Credentials>) => Promisable<TResult>;

/**
Owns one file operation's fresh snapshot, cross-process lock and cleanup.
*/
export class CredentialFile {
    readonly #path: string;

    constructor(path: string) {
        this.#path = nodePath.resolve(path);
    }

    private async resolvePath(): Promise<string> {
        await mkdir(nodePath.dirname(this.#path), { recursive: true, mode: 0o700 });
        try {
            return await realpath(this.#path);
        } catch (error) {
            if (!objectHasOwn(error, "code") || error.code !== "ENOENT") throw error;
            const directory = await realpath(nodePath.dirname(this.#path));
            return nodePath.join(directory, nodePath.basename(this.#path));
        }
    }

    private createDatabase(path: string, assertActive: () => void): Low<Credentials> {
        const reader = new JSONFile<CredentialDocument>(path);
        const adapter = {
            read: async () => {
                assertActive();
                const document = await reader.read();
                assertActive();
                return isDefined(document) ? decodeCredentials(document) : document;
            },
            write: async (credentials: Credentials): Promise<void> => {
                assertActive();
                await writeJsonFile(path, encodeCredentials(credentials), {
                    mode: 0o600,
                    indent: 2,
                });
            },
        } satisfies Adapter<Credentials>;

        return new Low<Credentials>(adapter, new Map());
    }

    async exclusive<TResult>(
        operation: FileOperation<TResult>,
        options?: OperationOptions,
    ): Promise<TResult> {
        options?.signal?.throwIfAborted();
        const path = await this.resolvePath();
        let compromised: Error | undefined;
        const assertActive = (): void => {
            options?.signal?.throwIfAborted();
            if (compromised) throw compromised;
        };
        const release = await lockfile.lock(path, {
            realpath: false,
            stale: 30_000,
            retries: { retries: 30, factor: 1.5, minTimeout: 50, maxTimeout: 1000 },
            onCompromised(error) {
                compromised = error;
            },
        });

        try {
            assertActive();
            const database = this.createDatabase(path, assertActive);
            await database.read();
            assertActive();
            const result = await operation(database);
            assertActive();
            return result;
        } finally {
            await release();
        }
    }
}
