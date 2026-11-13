import { setProvider } from "@flue/runtime";
import type { Plugin } from "vite";
import { ProviderAuthorization } from "../provider/index.ts";
import type { OAuthPluginOptions } from "../types.ts";

export function createPlugin(options: OAuthPluginOptions = {}): Plugin {
    const authorization = new ProviderAuthorization(options);

    return {
        name: "flue-oauth",
        apply: "serve",
        async configureServer() {
            setProvider(await authorization.resolve());
        },
    };
}
