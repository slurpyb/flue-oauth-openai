import type { Credential } from "@earendil-works/pi-ai";
import { objectEntries } from "ts-extras";
import * as v from "valibot";

const stringSchema = v.string();
const environmentSchema = v.record(stringSchema, stringSchema);
const expirySchema = v.pipe(v.number(), v.finite());
const apiKeySchema = v.looseObject({
    type: v.literal("api_key"),
    key: v.optional(stringSchema),
    env: v.optional(environmentSchema),
});
const oauthSchema = v.looseObject({
    type: v.literal("oauth"),
    access: stringSchema,
    refresh: stringSchema,
    expires: expirySchema,
});
const credentialSchema: v.GenericSchema<unknown, Credential> = v.variant("type", [
    apiKeySchema,
    oauthSchema,
]);
const credentialsSchema: v.GenericSchema<unknown, Map<string, Credential>> = v.pipe(
    v.record(stringSchema, credentialSchema),
    v.transform((document) => new Map<string, Credential>(objectEntries(document))),
);

export type Credentials = v.InferOutput<typeof credentialsSchema>;
export type CredentialDocument = Record<string, Credential>;

/**
Pi's provider-keyed JSON, retaining provider-owned credential fields.
*/
export function decodeCredentials(document: unknown): Credentials {
    const parsed = v.safeParse(credentialsSchema, document);
    if (!parsed.success) {
        throw new Error("Invalid credential file: expected provider-keyed credentials.");
    }
    return parsed.output;
}

export function encodeCredentials(
    credentials: ReadonlyMap<string, Credential>,
): CredentialDocument {
    return Object.fromEntries(credentials);
}
