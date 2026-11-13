import {
    createModels,
    type AuthInteraction,
    type CredentialStore,
    type LoginOptions,
    type Provider,
} from "@earendil-works/pi-ai";

export type AuthorizationOptions = {
    provider: Provider;
    credentials: CredentialStore;
    interaction?: AuthInteraction;
    login?: LoginOptions;
    signal?: AbortSignal;
};

/**
Keep OAuth resolution and refresh in a private Models collection while Flue
receives a provider whose authentication resolves on every request.
*/
export async function authorizeProvider({
    provider,
    credentials,
    interaction,
    login,
    signal,
}: AuthorizationOptions): Promise<Provider> {
    const oauth = provider.auth.oauth;
    if (!oauth) throw new Error(`${provider.name} does not support OAuth.`);

    const models = createModels({ credentials });
    models.setProvider({ ...provider, auth: { oauth } });

    if (!(await models.getAuth(provider.id, { signal }))) {
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
                ...interaction,
                signal: interactionSignal,
            },
            login,
        );
    }

    return {
        ...provider,
        auth: {
            apiKey: {
                name: oauth.name,
                async resolve({ signal: requestSignal }) {
                    const result = await models.getAuth(provider.id, { signal: requestSignal });
                    if (!result) throw new Error(`${provider.name} requires OAuth sign-in.`);
                    return result;
                },
            },
        },
    };
}
