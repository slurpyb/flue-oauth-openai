import { setProvider } from "@flue/runtime";
import { homedir } from "node:os";
import nodePath from "node:path";
import type { Plugin } from "vite";
import { authorizeProvider } from "../provider/index.ts";
import { openaiProvider } from "../provider/openai.ts";
import { createCredentialStore } from "../store/index.ts";
import type { OAuthPluginOptions } from "../types.ts";

export function createPlugin(options: OAuthPluginOptions = {}): Plugin {
    const configDirectory = process.env.XDG_CONFIG_HOME || nodePath.join(homedir(), ".config");
    const authPath = options.authPath ?? nodePath.join(configDirectory, "flue-oauth", "auth.json");
    const credentials = options.credentials ?? createCredentialStore(authPath);
    const provider = options.provider ?? openaiProvider();
    let authorization: ReturnType<typeof authorizeProvider> | undefined;

    return {
        name: "flue-oauth",
        apply: "serve",
        async configureServer() {
            try {
                authorization ??= authorizeProvider({
                    provider,
                    credentials,
                    interaction: options.interaction,
                    login: options.login,
                    signal: options.signal,
                });
                setProvider(await authorization);
            } catch (error) {
                authorization = undefined;
                throw error;
            }
        },
    };
}
