// Pin note formatting to its selected task provider. Secrets are resolved in
// the main process from the scope reference, never copied into call options.
export function buildNoteFormattingOverrides(noteFormatting) {
  const mode = noteFormatting?.mode;
  if (!["local", "providers", "self-hosted", "enterprise"].includes(mode)) {
    throw new Error("Choose a provider for note formatting.");
  }
  const provider =
    mode === "local" ? "local" : mode === "self-hosted" ? "lan" : noteFormatting.provider;
  return {
    inferenceScope: /** @type {const} */ ("noteFormatting"),
    provider,
    baseUrl: provider === "custom" ? noteFormatting.cloudBaseUrl || undefined : undefined,
    lanUrl: mode === "self-hosted" ? noteFormatting.remoteUrl || undefined : undefined,
    credentialRef:
      provider === "custom" || provider === "lan" ? "custom:noteFormatting" : undefined,
  };
}
