import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import {
    cleanupTemporaryRoots,
    temporaryAuthPath,
    testCredential,
} from "./helpers.ts";

afterEach(cleanupTemporaryRoots);

test.each(["custom", "unset", "empty"])(
    "should resolve the default credential location when XDG_CONFIG_HOME is %s",
    async (mode) => {
        const authPath = await temporaryAuthPath();
        const root = nodePath.dirname(nodePath.dirname(authPath));
        const home = nodePath.join(root, "home");
        const xdg = nodePath.join(root, "xdg");
        const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
        if (mode === "custom") {
            environment.XDG_CONFIG_HOME = xdg;
        } else if (mode === "empty") {
            environment.XDG_CONFIG_HOME = "";
        } else {
            delete environment.XDG_CONFIG_HOME;
        }
        const storeModule = new URL("../src/store/index.ts", import.meta.url).href;
        const script = `
            import { createCredentialStore } from ${JSON.stringify(storeModule)};
            await createCredentialStore().modify("openai", async () => (${JSON.stringify(testCredential)}));
        `;
        const child = Bun.spawn([process.execPath, "--eval", script], {
            env: environment,
            stdout: "ignore",
            stderr: "pipe",
            timeout: 5000,
        });

        const exitCode = await child.exited;
        const stderr = await new Response(child.stderr).text();

        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const directory = mode === "custom" ? xdg : nodePath.join(home, ".config");
        const document = await readFile(nodePath.join(directory, "flue-oauth", "auth.json"), "utf8");
        expect(JSON.parse(document)).toEqual({ openai: testCredential });
    },
);
