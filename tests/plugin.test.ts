import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { hasProvider, resetModelsForTests, resolveModel } from "@flue/runtime/internal";
import { afterEach, expect, mock, test } from "bun:test";
import { once } from "node:events";
import nodePath from "node:path";
import { createServer } from "vite";
import type { Plugin, ViteDevServer } from "vite";
import { createPlugin } from "../src/index.ts";
import { createCredentialStore } from "../src/store/index.ts";
import {
    cleanupTemporaryRoots,
    interaction,
    temporaryAuthPath,
    testCredential,
    testProvider,
} from "./helpers.ts";

const servers: Array<ViteDevServer> = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
    resetModelsForTests();
    await cleanupTemporaryRoots();
});

async function startServer(plugin: Plugin): Promise<ViteDevServer> {
    const root = nodePath.dirname(await temporaryAuthPath());
    const server = await createServer({
        configFile: false,
        root,
        plugins: [plugin],
        server: { middlewareMode: true, hmr: false },
        optimizeDeps: { noDiscovery: true, include: [] },
        logLevel: "silent",
    });
    servers.push(server);
    return server;
}

test("should persist first-use login and register with Flue when Vite starts", async () => {
    const authPath = await temporaryAuthPath();
    const provider = testProvider();
    const plugin = createPlugin({ authPath, provider, interaction });

    await startServer(plugin);

    expect(plugin.apply).toBe("serve");
    expect(hasProvider(provider.id)).toBe(true);
    expect(resolveModel("openai/gpt-5")).toMatchObject({ provider: provider.id, id: "gpt-5" });
    expect(await createCredentialStore(authPath).read(provider.id)).toEqual(testCredential);
});

test("should reuse one authorization when the same plugin starts two servers", async () => {
    const credentials = new InMemoryCredentialStore();
    const login = mock(() => Promise.resolve(testCredential));
    const plugin = createPlugin({ credentials, provider: testProvider({ login }), interaction });

    await Promise.all([startServer(plugin), startServer(plugin)]);

    expect(login).toHaveBeenCalledTimes(1);
    expect(hasProvider("openai")).toBe(true);
});

test("should retry authorization when a previous server startup failed", async () => {
    const failure = new Error("login failed");
    const login = mock(() => login.mock.calls.length === 1
        ? Promise.reject(failure)
        : Promise.resolve(testCredential));
    const plugin = createPlugin({
        credentials: new InMemoryCredentialStore(),
        provider: testProvider({ login }),
        interaction,
    });

    expect(startServer(plugin)).rejects.toBe(failure);
    expect(hasProvider("openai")).toBe(false);
    await startServer(plugin);

    expect(login).toHaveBeenCalledTimes(2);
    expect(hasProvider("openai")).toBe(true);
});

test("should reuse successful authorization when another server starts later", async () => {
    const credentials = new InMemoryCredentialStore();
    const login = mock(() => Promise.resolve(testCredential));
    const plugin = createPlugin({ credentials, provider: testProvider({ login }), interaction });

    await startServer(plugin);
    await startServer(plugin);

    expect(login).toHaveBeenCalledTimes(1);
    expect(hasProvider("openai")).toBe(true);
});

test("should retry one shared attempt when concurrent startups both fail", async () => {
    const failure = new Error("shared login failed");
    const starts = new EventTarget();
    const bothStarted = once(starts, "ready");
    const login = mock(async () => {
        if (login.mock.calls.length === 1) {
            await bothStarted;
            throw failure;
        }
        return testCredential;
    });
    const plugin = createPlugin({
        credentials: new InMemoryCredentialStore(),
        provider: testProvider({ login }),
        interaction,
    });
    const configureServer = plugin.configureServer;
    if (typeof configureServer !== "function") {
        throw new TypeError("Expected a configureServer function.");
    }
    let configuring = 0;
    const observedPlugin: Plugin = {
        ...plugin,
        configureServer(server) {
            const pending = configureServer.call(this, server);
            configuring += 1;
            if (configuring === 2) { starts.dispatchEvent(new Event("ready")); }
            return pending;
        },
    };

    const results = await Promise.allSettled([startServer(observedPlugin), startServer(observedPlugin)]);

    for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") { expect(result.reason).toBe(failure); }
    }
    expect(login).toHaveBeenCalledTimes(1);

    await startServer(plugin);
    expect(login).toHaveBeenCalledTimes(2);
    expect(hasProvider("openai")).toBe(true);
});

test("should refuse startup without registering when credentials and interaction are absent", () => {
    const plugin = createPlugin({
        credentials: new InMemoryCredentialStore(),
        provider: testProvider(),
    });

    expect(startServer(plugin)).rejects.toThrow("requires OAuth sign-in");
    expect(hasProvider("openai")).toBe(false);
});
