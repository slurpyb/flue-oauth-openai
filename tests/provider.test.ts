import { createModels, InMemoryCredentialStore, isModelType, ModelsError } from "@earendil-works/pi-ai";
import type { AuthEvent, AuthInteraction } from "@earendil-works/pi-ai";
import { afterEach, expect, mock, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { ProviderAuthorization } from "../src/provider/index.ts";
import { createCredentialStore } from "../src/store/index.ts";
import {
    authContext,
    cleanupTemporaryRoots,
    interaction,
    temporaryAuthPath,
    testCredential,
    testProvider,
} from "./helpers.ts";

afterEach(cleanupTemporaryRoots);

test("should resolve token headers and endpoint when a stored OAuth credential exists", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", () => Promise.resolve(testCredential));
    const provider = await new ProviderAuthorization({ provider: testProvider(), credentials }).resolve();

    expect(provider.auth.oauth).toBeUndefined();
    const result = await provider.auth.apiKey?.resolve({
        ctx: authContext,
        signal: new AbortController().signal,
    });
    expect(result?.auth).toEqual({
        apiKey: testCredential.access,
        headers: { "x-test-client": "client" },
        baseUrl: "https://example.invalid/v1",
    });
});

test("should select OpenAI when only an injected credential store is supplied", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", () => Promise.resolve(testCredential));

    const provider = await new ProviderAuthorization({ credentials }).resolve();
    const result = await provider.auth.apiKey?.resolve({
        ctx: authContext,
        signal: new AbortController().signal,
    });

    expect(provider.id).toBe("openai");
    expect(result?.auth.apiKey).toBe(testCredential.access);
});

test("should preserve subscription model filtering when the runtime has no OAuth credential", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", () => Promise.resolve(testCredential));
    const provider = await new ProviderAuthorization({ provider: testProvider(), credentials }).resolve();
    const runtime = createModels();
    runtime.setProvider(provider);

    expect(runtime.getAllModels("openai").some((model) => isModelType(model, "classifier"))).toBe(true);
    const available = await runtime.getAllAvailable("openai");
    expect(available.some((model) => isModelType(model, "classifier"))).toBe(false);
});

test("should update credential-aware filters when a request refreshes OAuth", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", () => Promise.resolve(testCredential));
    const original = testProvider();
    const filterModels = mock((models: ReturnType<typeof original.getModels>, credential: unknown) => {
        expect(credential).toMatchObject({ type: "oauth", access: "refreshed-access" });
        return models.slice(0, 1);
    });
    const provider = await new ProviderAuthorization({
        provider: { ...original, filterModels, filterAllModels: undefined },
        credentials,
    }).resolve();
    await credentials.modify("openai", () => Promise.resolve({ ...testCredential, expires: 0 }));
    const runtime = createModels();
    runtime.setProvider(provider);

    expect(await runtime.getAvailable("openai")).toHaveLength(1);
    expect(filterModels).toHaveBeenCalledTimes(1);
});

test("should sign in once and persist the credential when interaction is supplied", async () => {
    const credentials = createCredentialStore(await temporaryAuthPath());
    const login = mock(() => Promise.resolve(testCredential));

    await new ProviderAuthorization({ provider: testProvider({ login }), credentials, interaction }).resolve();

    expect(login).toHaveBeenCalledTimes(1);
    expect(await credentials.read("openai")).toEqual(testCredential);
});

test("should retain interaction methods and receivers when callbacks are on a prototype", async () => {
    class Interaction implements AuthInteraction {
        readonly code = "prototype-code";
        readonly events: Array<AuthEvent> = [];
        prompt(): Promise<string> { return Promise.resolve(this.code); }
        notify(event: AuthEvent): void { this.events.push(event); }
    }
    const callbacks = new Interaction();
    await new ProviderAuthorization({
        credentials: new InMemoryCredentialStore(),
        interaction: callbacks,
        provider: testProvider({
            async login(callbacks) {
                expect(await callbacks.prompt({ type: "text", message: "Code" })).toBe("prototype-code");
                callbacks.notify({ type: "progress", message: "Signed in" });
                return testCredential;
            },
        }),
    }).resolve();

    expect(callbacks.events).toEqual([{ type: "progress", message: "Signed in" }]);
});

test("should forward login options and combine signals when signing in", () => {
    const controller = new AbortController();
    const interactionController = new AbortController();
    const loginOptions = { agentName: "test-agent", getDeviceId: () => "device-id" };
    const authorization = new ProviderAuthorization({
        credentials: new InMemoryCredentialStore(),
        signal: controller.signal,
        interaction: { ...interaction, signal: interactionController.signal },
        login: loginOptions,
        provider: testProvider({
            login(callbacks, options) {
                expect(options).toBe(loginOptions);
                interactionController.abort();
                expect(callbacks.signal.aborted).toBe(true);
                callbacks.signal.throwIfAborted();
                return Promise.resolve(testCredential);
            },
        }),
    }).resolve();
    expect(authorization).rejects.toMatchObject({ name: "AbortError" });
});

test("should fail without prompting when no credential or interaction exists", () => {
    expect(new ProviderAuthorization({
        provider: testProvider(),
        credentials: new InMemoryCredentialStore(),
    }).resolve()).rejects.toThrow("requires OAuth sign-in");
});

test("should reject non-OAuth providers when authorization is requested", () => {
    expect(new ProviderAuthorization({
        provider: { ...testProvider(), auth: {} },
        credentials: new InMemoryCredentialStore(),
    }).resolve()).rejects.toThrow("does not support OAuth");
});

test("should surface storage failures instead of logging in when the file is corrupt", async () => {
    const path = await temporaryAuthPath();
    await writeFile(path, "not json");
    const login = mock(() => Promise.resolve(testCredential));

    expect(new ProviderAuthorization({
        provider: testProvider({ login }),
        credentials: createCredentialStore(path),
        interaction,
    }).resolve()).rejects.toBeInstanceOf(ModelsError);
    expect(login).not.toHaveBeenCalled();
});

test("should refresh once when concurrent requests find an expired token", async () => {
    const path = await temporaryAuthPath();
    await writeFile(path, JSON.stringify({ openai: testCredential }));
    const credentials = createCredentialStore(path);
    const refresh = mock(() => Promise.resolve({ ...testCredential, access: "rotated-token" }));
    const provider = await new ProviderAuthorization({ provider: testProvider({ refresh }), credentials }).resolve();
    await credentials.modify("openai", () => Promise.resolve({ ...testCredential, expires: 0 }));
    const runtime = createModels();
    runtime.setProvider(provider);

    const results = await Promise.all(Array.from({ length: 6 }, () => runtime.getAuth("openai")));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result?.auth.apiKey === "rotated-token")).toBe(true);
    expect(await credentials.read("openai")).toMatchObject({ access: "rotated-token" });
});

test("should reject the next request when the stored credential has been deleted", async () => {
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", () => Promise.resolve(testCredential));
    const provider = await new ProviderAuthorization({ provider: testProvider(), credentials }).resolve();
    await credentials.delete("openai");

    expect(provider.auth.apiKey?.resolve({
        ctx: authContext,
        signal: new AbortController().signal,
    })).rejects.toThrow("requires OAuth sign-in");
});
