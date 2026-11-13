import type { CredentialStore } from "@earendil-works/pi-ai";
import type { Low } from "lowdb";
import { isDefined } from "ts-extras";
import { CredentialFile } from "./file.ts";
import type { Credentials } from "./schema.ts";

type CredentialUpdater = Parameters<CredentialStore["modify"]>[1];

class CredentialStoreAdapter implements CredentialStore {
    readonly read: CredentialStore["read"] = (providerId, options) =>
        this.file.exclusive((database) => database.data.get(providerId), options);

    readonly list: CredentialStore["list"] = (options) =>
        this.file.exclusive(
            (database) =>
                Array.from(database.data, ([providerId, credential]) => ({
                    providerId,
                    type: credential.type,
                })),
            options,
        );

    readonly modify: CredentialStore["modify"] = (providerId, update, options) =>
        this.file.exclusive(
            (database) => applyCredentialUpdate(database, providerId, update),
            options,
        );

    readonly delete: CredentialStore["delete"] = (providerId, options) =>
        this.file.exclusive(async (database) => {
            if (!database.data.has(providerId)) return;
            await database.update((credentials) => credentials.delete(providerId));
        }, options);

    constructor(private readonly file: CredentialFile) {}
}

/**
The updater is awaited before entering lowdb's synchronous mutation API.
*/
async function applyCredentialUpdate(
    database: Low<Credentials>,
    providerId: string,
    update: CredentialUpdater,
): ReturnType<CredentialStore["modify"]> {
    const current = database.data.get(providerId);
    const next = await update(current);
    if (!isDefined(next)) return current;

    await database.update((credentials) => credentials.set(providerId, next));
    return next;
}

/**
A persistent Pi credential store at an explicit auth.json path.
*/
export function createCredentialStore(path: string): CredentialStore {
    return new CredentialStoreAdapter(new CredentialFile(path));
}
