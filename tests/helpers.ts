import type {
    AuthContext,
    AuthInteraction,
    OAuthAuth,
    OAuthCredential,
    Provider,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

const roots: Array<string> = [];

export const testCredential: OAuthCredential = {
    type: "oauth",
    access: "access-token",
    refresh: "refresh-token",
    expires: Number.MAX_SAFE_INTEGER,
    clientId: "client",
};

export const authContext: AuthContext = {
    env: async () => {},
    fileExists: () => Promise.resolve(false),
};

export const interaction: AuthInteraction = {
    prompt: () => Promise.resolve("test-code"),
    notify() {},
};

export function testProvider(oauth: Partial<OAuthAuth> = {}): Provider {
    return {
        ...openaiProvider(),
        auth: {
            oauth: {
                name: "Test OAuth",
                login: () => Promise.resolve({ ...testCredential }),
                refresh: (credential) => Promise.resolve({
                    ...credential,
                    access: "refreshed-access",
                    expires: Number.MAX_SAFE_INTEGER,
                }),
                toAuth: (credential) => Promise.resolve({
                    apiKey: credential.access,
                    headers: { "x-test-client": String(credential.clientId) },
                    baseUrl: "https://example.invalid/v1",
                }),
                ...oauth,
            },
        },
    };
}

export async function temporaryAuthPath(): Promise<string> {
    const root = await mkdtemp(nodePath.join(tmpdir(), "flue-oauth-"));
    roots.push(root);
    const directory = nodePath.join(root, "config");
    await mkdir(directory, { recursive: true });
    return nodePath.join(directory, "auth.json");
}

export async function cleanupTemporaryRoots(): Promise<void> {
    await Promise.all(
        roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
}
