import type {
    AuthInteraction,
    CredentialStore,
    LoginOptions,
    Provider,
} from "@earendil-works/pi-ai";
import type { MergeExclusive } from "type-fest";

type CredentialSource = MergeExclusive<{ authPath?: string }, { credentials: CredentialStore }>;

export type OAuthPluginOptions = CredentialSource & {
    provider?: Provider;
    interaction?: AuthInteraction;
    login?: LoginOptions;
    signal?: AbortSignal;
};

export { createPlugin } from "./plugin/index.ts";
