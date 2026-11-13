import type {
    AuthInteraction,
    CredentialStore,
    LoginOptions,
    Provider,
} from "@earendil-works/pi-ai";

export interface AuthorizationOptions {
    provider?: Provider;
    credentials?: CredentialStore;
    authPath?: string;
    interaction?: AuthInteraction;
    login?: LoginOptions;
    signal?: AbortSignal;
}

export type AsyncState<T> =
    | { status: "idle" }
    | { status: "loading"; promise: Promise<T> }
    | { status: "success"; data: T }
    | { status: "error"; error: unknown };
