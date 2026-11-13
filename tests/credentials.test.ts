import { afterEach, expect, test } from "bun:test";
import { lstat, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import lockfile from "proper-lockfile";
import { createCredentialStore } from "../src/store/index.ts";
import {
    cleanupTemporaryRoots,
    temporaryAuthPath,
    testCredential,
} from "./helpers.ts";

afterEach(cleanupTemporaryRoots);

test("should read an empty store when the credential file is missing", async () => {
    const path = await temporaryAuthPath();
    const store = createCredentialStore(path);

    expect(await store.read("openai")).toBeUndefined();
    expect(await store.list()).toEqual([]);
    expect(await readdir(nodePath.dirname(path))).toEqual([]);
});

test("should persist credentials and metadata when modified and deleted", async () => {
    const path = await temporaryAuthPath();
    const store = createCredentialStore(path);

    expect(await store.modify("openai", () => Promise.resolve(testCredential))).toEqual(testCredential);
    expect(await store.read("openai")).toEqual(testCredential);
    expect(await store.list()).toEqual([{ providerId: "openai", type: "oauth" }]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ openai: testCredential });

    await store.delete("openai");
    expect(await store.read("openai")).toBeUndefined();
    expect(await store.list()).toEqual([]);
});

test.each(["null", "[]", "not json", '{"openai":{"type":"oauth","access":""}}'])(
    "should reject corrupt input when the file contains %s",
    async (document) => {
        const path = await temporaryAuthPath();
        await writeFile(path, document);

        expect(createCredentialStore(path).read("openai")).rejects.toThrow();
        expect(await readFile(path, "utf8")).toBe(document);
        expect(await readdir(nodePath.dirname(path))).toEqual(["auth.json"]);
    },
);

test("should retain provider-owned fields when another credential is written", async () => {
    const path = await temporaryAuthPath();
    const credential = { ...testCredential, scopes: ["responses"], account: { id: "account" } };
    await writeFile(path, JSON.stringify({ openai: credential }));
    const store = createCredentialStore(path);

    await store.modify("other", () => Promise.resolve({
        type: "api_key",
        key: "other-key",
        env: { ACCOUNT: "test" },
    }));

    expect(await store.read("openai")).toEqual(credential);
    expect(await store.list()).toEqual([
        { providerId: "openai", type: "oauth" },
        { providerId: "other", type: "api_key" },
    ]);
});

test("should preserve the current entry when the updater returns undefined", async () => {
    const path = await temporaryAuthPath();
    const store = createCredentialStore(path);
    await store.modify("openai", () => Promise.resolve(testCredential));
    const before = await readFile(path, "utf8");

    expect(await store.modify("openai", async () => {})).toEqual(testCredential);
    expect(await readFile(path, "utf8")).toBe(before);
});

test("should release the lock without writing when the updater rejects", async () => {
    const path = await temporaryAuthPath();
    const store = createCredentialStore(path);
    await store.modify("openai", () => Promise.resolve(testCredential));
    const failure = new Error("updater failed");

    expect(store.modify("openai", () => { return Promise.reject(failure); })).rejects.toBe(failure);
    expect(await store.read("openai")).toEqual(testCredential);
    expect(await readdir(nodePath.dirname(path))).toEqual(["auth.json"]);
});

test("should preserve every update when independent stores modify concurrently", async () => {
    const path = await temporaryAuthPath();
    await writeFile(path, "{}");

    await Promise.all(
        Array.from({ length: 6 }, () =>
            createCredentialStore(path).modify("openai", (current) => Promise.resolve({
                ...testCredential,
                expires: (current?.type === "oauth" ? current.expires : 0) + 1,
            })),
        ),
    );

    const stored = await createCredentialStore(path).read("openai");
    expect(stored?.type === "oauth" ? stored.expires : undefined).toBe(6);
});

test("should preserve every update when separate processes share the file", async () => {
    const path = await temporaryAuthPath();
    const storeModule = new URL("../src/store/index.ts", import.meta.url).href;
    const script = `
        import { createCredentialStore } from ${JSON.stringify(storeModule)};
        const store = createCredentialStore(${JSON.stringify(path)});
        const credential = ${JSON.stringify(testCredential)};
        for (let index = 0; index < 3; index++) {
            await store.modify("openai", async (current) => ({
                ...credential,
                expires: (current?.type === "oauth" ? current.expires : 0) + 1,
            }));
        }
    `;
    const children = Array.from({ length: 3 }, () => Bun.spawn(
        [process.execPath, "--eval", script],
        { stdout: "ignore", stderr: "pipe", timeout: 5000 },
    ));

    const results = await Promise.all(children.map(async (child) => ({
        exitCode: await child.exited,
        stderr: await new Response(child.stderr).text(),
    })));

    expect(results).toEqual(Array.from({ length: 3 }, () => ({ exitCode: 0, stderr: "" })));
    const stored = await createCredentialStore(path).read("openai");
    expect(stored?.type === "oauth" ? stored.expires : undefined).toBe(9);
}, 10_000);

test("should perform no I/O when an operation is already aborted", async () => {
    const path = nodePath.join(await temporaryAuthPath(), "nested", "auth.json");
    const signal = AbortSignal.abort();

    expect(createCredentialStore(path).read("openai", { signal })).rejects.toThrow();
    expect(stat(nodePath.dirname(path))).rejects.toMatchObject({ code: "ENOENT" });
});

test("should cancel promptly without stealing the lock when another writer holds it", async () => {
    const path = await temporaryAuthPath();
    await writeFile(path, "{}");
    const release = await lockfile.lock(path);
    const controller = new AbortController();
    const pending = createCredentialStore(path).read("openai", { signal: controller.signal });
    const timer = setTimeout(() => { controller.abort(); }, 20);

    try {
        const outcome = await Promise.race([
            (async () => {
                try {
                    await pending;
                    return "completed";
                } catch {
                    return "aborted";
                }
            })(),
            (async () => {
                await Bun.sleep(500);
                return "timed out";
            })(),
        ]);
        expect(outcome).toBe("aborted");
        expect(await lockfile.check(path)).toBe(true);
    } finally {
        clearTimeout(timer);
        await release();
        try {
            await pending;
        } catch {
            // The cancelled reader must settle before its temporary root is removed.
        }
    }
});

test("should not persist an update when cancellation occurs inside the updater", async () => {
    const path = await temporaryAuthPath();
    const controller = new AbortController();
    const store = createCredentialStore(path);

    expect(store.modify("openai", () => {
        controller.abort();
        return Promise.resolve(testCredential);
    }, { signal: controller.signal })).rejects.toThrow();
    expect(await store.read("openai")).toBeUndefined();
});

test.skipIf(process.platform === "win32")(
    "should keep tokens private and remove temporaries when writing credentials",
    async () => {
        const path = await temporaryAuthPath();
        await writeFile(path, "{}", { mode: 0o644 });

        await createCredentialStore(path).modify("openai", () => Promise.resolve(testCredential));

        const permissions = await stat(path);
        expect(permissions.mode & 0o777).toBe(0o600);
        expect(await readdir(nodePath.dirname(path))).toEqual(["auth.json"]);
    },
);

test.skipIf(process.platform === "win32")(
    "should preserve the link and serialize its target when accessed through a symlink",
    async () => {
        const path = await temporaryAuthPath();
        const target = nodePath.join(nodePath.dirname(path), "target.json");
        await writeFile(target, "{}");
        await symlink(target, path);

        await Promise.all(
            [path, target].map((file) => createCredentialStore(file).modify("openai", (current) => Promise.resolve({
                ...testCredential,
                expires: (current?.type === "oauth" ? current.expires : 0) + 1,
            }))),
        );

        const stored = await createCredentialStore(target).read("openai");
        expect(stored?.type === "oauth" ? stored.expires : undefined).toBe(2);
        const link = await lstat(path);
        expect(link.isSymbolicLink()).toBe(true);
    },
);
