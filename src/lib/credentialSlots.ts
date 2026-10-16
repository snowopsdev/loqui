import type { CredentialId } from "./routeGraph";

// Main's credential slots (src/helpers/credentialAuthority.js): the 16
// CredentialIds plus the seven custom-endpoint keys, named like the
// personal-inference credential refs (main.js credentialSlot).
export type CustomCredentialSlot =
  | "custom:transcription"
  | "custom:dictationCleanup"
  | "custom:noteFormatting"
  | "custom:dictationTranslation"
  | "custom:dictationAgent"
  | "custom:dictationAgentVision"
  | "custom:chatIntelligence";
export type CredentialSlot = CredentialId | CustomCredentialSlot;
export type CredentialField =
  "key" | "clientId" | "clientSecret" | "accessKeyId" | "secretAccessKey" | "sessionToken";

/** What an acknowledged secret save resolves to (Task 2). */
export interface SecretSaveResult {
  ok: boolean;
  error?: string;
}

export const CUSTOM_CREDENTIAL_SLOTS: readonly CustomCredentialSlot[] = [
  "custom:transcription",
  "custom:dictationCleanup",
  "custom:noteFormatting",
  "custom:dictationTranslation",
  "custom:dictationAgent",
  "custom:dictationAgentVision",
  "custom:chatIntelligence",
];

// One credential stored in several fields. Remove takes the whole credential
// (main's remove clears every field) and Undo restores every field. There is
// no per-field removal: half a Corti client pair or half a Bedrock key pair
// is not a usable credential.
export const MULTI_FIELD_CREDENTIALS: ReadonlySet<CredentialSlot> = new Set<CredentialSlot>([
  "corti:speech",
  "bedrock",
]);

// Store field → main slot and field. Corti text and speech are separate
// identities: different credentials.
export const SECRET_STORE_SLOTS = {
  openaiApiKey: ["openai", "key"],
  anthropicApiKey: ["anthropic", "key"],
  geminiApiKey: ["gemini", "key"],
  groqApiKey: ["groq", "key"],
  xaiApiKey: ["xai", "key"],
  mistralApiKey: ["mistral", "key"],
  openrouterApiKey: ["openrouter", "key"],
  tinfoilApiKey: ["tinfoil", "key"],
  deepgramApiKey: ["deepgram", "key"],
  assemblyaiApiKey: ["assemblyai", "key"],
  cortiApiKey: ["corti:text", "key"],
  cortiClientId: ["corti:speech", "clientId"],
  cortiClientSecret: ["corti:speech", "clientSecret"],
  customTranscriptionApiKey: ["custom:transcription", "key"],
  cleanupCustomApiKey: ["custom:dictationCleanup", "key"],
  noteFormattingCustomApiKey: ["custom:noteFormatting", "key"],
  translationCustomApiKey: ["custom:dictationTranslation", "key"],
  dictationAgentCustomApiKey: ["custom:dictationAgent", "key"],
  dictationAgentVisionCustomApiKey: ["custom:dictationAgentVision", "key"],
  chatAgentCustomApiKey: ["custom:chatIntelligence", "key"],
  bedrockAccessKeyId: ["bedrock", "accessKeyId"],
  bedrockSecretAccessKey: ["bedrock", "secretAccessKey"],
  bedrockSessionToken: ["bedrock", "sessionToken"],
  azureApiKey: ["azure", "key"],
  vertexApiKey: ["vertex", "key"],
} as const satisfies Record<string, readonly [CredentialSlot, CredentialField]>;

export type SecretStoreKey = keyof typeof SECRET_STORE_SLOTS;

export function credentialSlotForStoreKey(storeKey: string): CredentialSlot | undefined {
  return Object.hasOwn(SECRET_STORE_SLOTS, storeKey)
    ? SECRET_STORE_SLOTS[storeKey as SecretStoreKey][0]
    : undefined;
}

export function isSecretStoreKey(key: string): key is SecretStoreKey {
  return Object.hasOwn(SECRET_STORE_SLOTS, key);
}

const REF_SLOTS: ReadonlySet<string> = new Set<string>([
  ...Object.values(SECRET_STORE_SLOTS).map(([slot]) => slot),
  ...CUSTOM_CREDENTIAL_SLOTS,
]);

// A personal-inference credential ref (OpenAICompatiblePanel's credentialRef,
// main.js credentialSlot) → its slot. "corti" is the Corti text key, as in
// the BYOK table; anything unknown has no slot, so it gets no Remove.
export function credentialSlotForRef(ref: string | undefined): CredentialSlot | undefined {
  if (!ref) return undefined;
  if (ref === "corti") return "corti:text";
  return REF_SLOTS.has(ref) ? (ref as CredentialSlot) : undefined;
}

// For a key field whose owner has nowhere to save it (an optional callback
// that was not passed). Never writes; the field keeps the draft and says so.
export const unavailableSecretSave = async (_value: string): Promise<SecretSaveResult> => ({
  ok: false,
  error: "unavailable",
});
