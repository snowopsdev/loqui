async function initializeVertexAuthSource({
  hasExistingSettingsProfile,
  environment,
  credentials,
}) {
  const migrationEpoch = environment.getEnvWriteEpoch();
  await environment.drainEnvWrites();
  // Always join the Vertex slot queue, even when a valid source is already
  // stored. This makes the migration boundary follow any admitted credential
  // save; a valid source is preserved and is never re-derived from that save.
  const capture = await credentials.captureCommitted("vertex");
  if (!capture) throw new Error("Vertex credentials are unavailable during source migration");
  const storedSource = environment.getVertexAuthSource();
  // Fresh profiles always start in ADC, including when an ambient API key or
  // inherited VERTEX_AUTH_SOURCE exists. Existing valid persisted choices win.
  let source = hasExistingSettingsProfile && storedSource ? storedSource : null;
  if (source === null) {
    source = "adc";
    if (hasExistingSettingsProfile) {
      // captureCommitted is main-only and queued behind any already-admitted
      // save. Its effective value checks VERTEX_API_KEY before legacy env.
      source = capture.values.key ? "apiKey" : "adc";
    }
  }
  // getVertexAuthSource also sees process.env inherited at launch. Persist an
  // accepted source even when already valid so the next launch cannot choose a
  // different recipient merely because that ambient variable disappeared.
  const saved = await environment.saveVertexAuthSource(source, { expectedEpoch: migrationEpoch });
  if (!saved?.success) throw new Error("Could not persist Vertex auth source");
  return source;
}

module.exports = { initializeVertexAuthSource };
