import { createModels } from "@earendil-works/pi-ai";
import type { Credential, Provider } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { assertNever } from "ts-extras";
import { createCredentialStore } from "../store/index.ts";
import type { AsyncState, AuthorizationOptions } from "./types.ts";

/**
One authorization session per plugin. Callers share startup attempts and reuse
success; a rejected attempt can be retried. Request-time refresh remains Pi-owned.
*/
export class ProviderAuthorization {
    #state: AsyncState<Provider> = { status: "idle" };

    constructor(private readonly options: AuthorizationOptions = {}) {}

    async resolve(): Promise<Provider> {
        switch (this.#state.status) {
            case "success": {
                return this.#state.data;
            }
            case "loading": {
                return this.#state.promise;
            }
            case "idle":
            case "error": {
                const promise = this.authorize();
                this.#state = { status: "loading", promise };
                try {
                    const provider = await promise;
                    this.#state = { status: "success", data: provider };
                    return provider;
                } catch (error) {
                    this.#state = { status: "error", error };
                    throw error;
                }
            }
            default: {
                return assertNever(this.#state);
            }
        }
    }

    private async authorize(): Promise<Provider> {
        const { provider = openaiProvider(), interaction, login, signal } = this.options;
        const credentials = this.options.credentials ?? createCredentialStore(this.options.authPath);
        const oauth = provider.auth.oauth;
        if (!oauth) { throw new Error(`${provider.name} does not support OAuth.`); }

        const models = createModels({ credentials });
        models.setProvider({ ...provider, auth: { oauth } });
        let credential: Credential | undefined;

        // Availability needs the stored credential, which Flue's own Models
        // collection does not have. Read it here rather than mutating toAuth.
        const resolveAuth = async (signal?: AbortSignal) => {
            const auth = await models.getAuth(provider.id, { signal });
            credential = auth ? await credentials.read(provider.id, { signal }) : undefined;
            return auth;
        };

        if (!(await resolveAuth(signal))) {
            if (!interaction) {
                throw new Error(
                    `${provider.name} requires OAuth sign-in. Supply an auth interaction to sign in.`,
                );
            }
            const interactionSignal = signal
                ? AbortSignal.any([signal, ...(interaction.signal ? [interaction.signal] : [])])
                : interaction.signal;
            await models.login(
                provider.id,
                "oauth",
                {
                    prompt: (prompt) => interaction.prompt(prompt),
                    notify: (event) => { interaction.notify(event); },
                    signal: interactionSignal,
                },
                login,
            );
            if (!(await resolveAuth(signal))) {
                throw new Error(`${provider.name} requires OAuth sign-in.`);
            }
        }

        return {
            ...provider,
            filterModels: provider.filterModels
                ? (models) => provider.filterModels?.(models, credential) ?? models
                : undefined,
            filterAllModels: provider.filterAllModels
                ? (models) => provider.filterAllModels?.(models, credential) ?? models
                : undefined,
            auth: {
                apiKey: {
                    name: oauth.name,
                    async resolve({ signal }) {
                        const result = await resolveAuth(signal);
                        if (!result) { throw new Error(`${provider.name} requires OAuth sign-in.`); }
                        return result;
                    },
                },
            },
        };
    }
}
