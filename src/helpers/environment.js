const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const fsPromises = require("fs/promises");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const { normalizeUiLanguage } = require("./i18nMain");
const secretCrypto = require("./secretCrypto");
const { BYOK_API_KEYS } = require("../config/secretKeys");

const SECRET_KEYS = [
  ...BYOK_API_KEYS.map((k) => k.env),
  "CORTI_CLIENT_ID",
  "CORTI_CLIENT_SECRET",
  "CUSTOM_TRANSCRIPTION_API_KEY",
  "CUSTOM_CLEANUP_API_KEY",
  "BEDROCK_ACCESS_KEY_ID",
  "BEDROCK_SECRET_ACCESS_KEY",
  "BEDROCK_SESSION_TOKEN",
  "AZURE_OPENAI_API_KEY",
  "VERTEX_API_KEY",
];

const SECRET_KEY_SET = new Set(SECRET_KEYS);

const PERSISTED_KEYS = [
  ...SECRET_KEYS,
  "LOCAL_TRANSCRIPTION_PROVIDER",
  "PARAKEET_MODEL",
  "DICTATION_LANGUAGE",
  "LOCAL_WHISPER_MODEL",
  "CLEANUP_PROVIDER",
  "LOCAL_CLEANUP_MODEL",
  "DICTATION_AGENT_PROVIDER",
  "LOCAL_DICTATION_AGENT_MODEL",
  "LLAMA_GPU_BACKEND",
  "LLAMA_VULKAN_ENABLED",
  "DICTATION_KEY",
  "VOICE_AGENT_KEY",
  "TRANSLATION_KEY",
  "MEETING_KEY",
  "ACTIVATION_MODE",
  "FLOATING_ICON_AUTO_HIDE",
  "PANEL_START_POSITION",
  "START_MINIMIZED",
  "UI_LANGUAGE",
  "WHISPER_CUDA_ENABLED",
  "WHISPER_VULKAN_ENABLED",
  "WHISPER_VULKAN_DEVICE",
  "WHISPER_GPU_FAILED",
  "WHISPER_THREADS",
  "TRANSCRIPTION_GPU_UUID",
  "INTELLIGENCE_GPU_UUID",
  "BEDROCK_REGION",
  "BEDROCK_PROFILE",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "VERTEX_PROJECT",
  "VERTEX_LOCATION",
  "VERTEX_AUTH_SOURCE",
];

// Module-level so writes are serialized across all instances — hotkeyManager
// creates its own EnvironmentManager alongside the main.js singleton.
let envWriteQueue = Promise.resolve();
let envWriteEpoch = 0;
let envWriteFenced = false;
// Per-key native durability is sufficient to avoid re-copying a newly saved
// secret to plaintext while an older all-key migration remains incomplete.
const nativeCommittedKeys = new Set();
const unknownPersistedKeys = new Set();

function environmentResetError() {
  return Object.assign(new Error("Environment persistence is resetting"), { code: "ENV_RESET" });
}

function enqueueEnvWrite(write) {
  if (envWriteFenced) return Promise.reject(environmentResetError());
  const epoch = envWriteEpoch;
  const queued = envWriteQueue
    .catch(() => {})
    .then(async () => {
      if (envWriteFenced || epoch !== envWriteEpoch) throw environmentResetError(); // invalidated while queued
      await write();
      if (envWriteFenced || epoch !== envWriteEpoch) throw environmentResetError();
      return true;
    });
  envWriteQueue = queued;
  return queued;
}

const ENTERPRISE_ROUTE_ENV_KEYS = Object.freeze({
  bedrockRegion: "BEDROCK_REGION",
  azureEndpoint: "AZURE_OPENAI_ENDPOINT",
  vertexProject: "VERTEX_PROJECT",
  vertexLocation: "VERTEX_LOCATION",
  vertexAuthSource: "VERTEX_AUTH_SOURCE",
});
const ENTERPRISE_ROUTE_KEYS = Object.keys(ENTERPRISE_ROUTE_ENV_KEYS);

function isEnterpriseRouteSettings(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    ENTERPRISE_ROUTE_KEYS.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(value, key) &&
        typeof value[key] === "string" &&
        !/[\r\n\0]/.test(value[key]) &&
        (key !== "vertexAuthSource" || value[key] === "adc" || value[key] === "apiKey")
    ) &&
    Object.keys(value).every((key) => ENTERPRISE_ROUTE_KEYS.includes(key))
  );
}

class EnvironmentManager {
  constructor() {
    this.loadEnvironmentVariables();
  }

  loadEnvironmentVariables() {
    // App config (.env in userData) takes precedence over system env vars,
    // so keys saved by the user in Settings always win.
    const userDataEnv = path.join(app.getPath("userData"), ".env");
    try {
      if (fs.existsSync(userDataEnv)) {
        dotenv.config({ path: userDataEnv, override: true, quiet: true });
      }
    } catch {}

    const fallbackPaths = [
      path.join(__dirname, "..", "..", ".env"), // Development
      path.join(process.resourcesPath, ".env"),
      path.join(process.resourcesPath, "app.asar.unpacked", ".env"),
      path.join(process.resourcesPath, "app", ".env"), // Legacy
    ];

    for (const envPath of fallbackPaths) {
      try {
        if (fs.existsSync(envPath)) {
          dotenv.config({ path: envPath, quiet: true });
        }
      } catch {}
    }
  }

  // Encryption initializes lazily. Probing it eagerly would touch the macOS
  // Keychain before any window is visible. Migration and _loadAllSecrets are
  // both no-ops on fresh installs, so neither path triggers Keychain until
  // the user actually saves their first secret.
  async init() {
    if (!fs.existsSync(this._getMigrationSentinelPath())) {
      await this._migrateToSecureStorage();
    }
    await this._loadAllSecrets();
  }

  _getMigrationSentinelPath() {
    return path.join(this._getSecureKeysDir(), ".migrated");
  }

  _encryptionAvailable() {
    try {
      return secretCrypto.isAvailable();
    } catch {
      return false;
    }
  }

  _getSecureKeysDir() {
    return path.join(app.getPath("userData"), "secure-keys");
  }

  _getSecretFilePath(envVarName) {
    return path.join(this._getSecureKeysDir(), `${envVarName}.enc`);
  }

  async _loadAllSecrets() {
    await Promise.all(SECRET_KEYS.map((name) => this._loadSecretKey(name)));
  }

  async _loadSecretKey(envVarName) {
    const filePath = this._getSecretFilePath(envVarName);
    try {
      const buffer = await fsPromises.readFile(filePath);
      const { value, needsReencrypt } = secretCrypto.decrypt(buffer);
      process.env[envVarName] = value;
      nativeCommittedKeys.add(envVarName);
      if (needsReencrypt) await this._saveSecretKey(envVarName, value);
    } catch (error) {
      if (error.code === "ENOENT") return;
      debugLogger.error(
        "Failed to decrypt secret — user must re-enter",
        { key: envVarName, code: error.code, error: error.message },
        "environment"
      );
    }
  }

  async _saveSecretKey(envVarName, value, { publish = true } = {}) {
    if (!value) {
      await this._deleteSecretKey(envVarName, { publish });
      return;
    }

    const dir = this._getSecureKeysDir();
    await fsPromises.mkdir(dir, { recursive: true });

    const filePath = this._getSecretFilePath(envVarName);
    const tmpPath = `${filePath}.tmp`;
    const encrypted = secretCrypto.encrypt(value);

    await fsPromises.writeFile(tmpPath, encrypted);
    await fsPromises.rename(tmpPath, filePath);
    if (publish) process.env[envVarName] = value;
  }

  async _deleteSecretKey(envVarName, { publish = true } = {}) {
    try {
      await fsPromises.unlink(this._getSecretFilePath(envVarName));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (publish) delete process.env[envVarName];
  }

  async _migrateToSecureStorage() {
    const dir = this._getSecureKeysDir();
    await fsPromises.mkdir(dir, { recursive: true });

    // Adopt renamed key so the value survives migration. Old releases stored
    // it under CUSTOM_REASONING_API_KEY; new code only encrypts CUSTOM_CLEANUP_API_KEY.
    if (process.env.CUSTOM_REASONING_API_KEY && !process.env.CUSTOM_CLEANUP_API_KEY) {
      process.env.CUSTOM_CLEANUP_API_KEY = process.env.CUSTOM_REASONING_API_KEY;
    }
    delete process.env.CUSTOM_REASONING_API_KEY;

    const migrated = [];
    try {
      for (const name of SECRET_KEYS) {
        const value = process.env[name];
        if (!value) continue;
        await this._saveSecretKey(name, value);
        // Round-trip verify before stripping plaintext .env.
        const buffer = await fsPromises.readFile(this._getSecretFilePath(name));
        if (secretCrypto.decrypt(buffer).value !== value) {
          throw new Error(`round-trip verification failed for ${name}`);
        }
        nativeCommittedKeys.add(name);
        migrated.push(name);
      }
    } catch (error) {
      debugLogger.error(
        "Secret migration aborted — plaintext .env preserved",
        { error: error.message, migrated },
        "environment"
      );
      return;
    }

    // Write sentinel before stripping plaintext from .env so a crash mid-rewrite is recoverable.
    await fsPromises.writeFile(this._getMigrationSentinelPath(), "");
    const envPath = path.join(app.getPath("userData"), ".env");
    if (fs.existsSync(envPath)) await this._writeEnvFileAtomic(envPath);
    debugLogger.info(
      "Migrated secrets to encrypted storage",
      { count: migrated.length },
      "environment"
    );
  }

  _writeEnvFileAtomic(envPath) {
    return enqueueEnvWrite(() => this._writeEnvFile(envPath));
  }

  async _writeEnvFile(envPath, explicitValues = {}) {
    if (unknownPersistedKeys.size)
      throw Object.assign(
        new Error("Credential persistence is unknown; reopen or reset before rewriting settings"),
        { code: "CREDENTIAL_UNKNOWN" }
      );
    // Strip all plaintext secrets only after full migration. Before then,
    // omit only keys with an independently confirmed durable native copy.
    const stripSecrets =
      this._encryptionAvailable() && fs.existsSync(this._getMigrationSentinelPath());
    let envContent = "# OpenWhispr Environment Variables\n";
    for (const key of PERSISTED_KEYS) {
      if (
        SECRET_KEY_SET.has(key) &&
        (stripSecrets || (this._encryptionAvailable() && nativeCommittedKeys.has(key)))
      )
        continue;
      const value = Object.prototype.hasOwnProperty.call(explicitValues, key)
        ? explicitValues[key]
        : process.env[key];
      if (value) envContent += `${key}=${value}\n`;
    }
    const tmpPath = `${envPath}.tmp`;
    await fsPromises.writeFile(tmpPath, envContent, "utf8");
    await fsPromises.rename(tmpPath, envPath);
  }

  _getKey(envVarName) {
    return process.env[envVarName] || "";
  }

  _saveKey(envVarName, key) {
    if (envWriteFenced) throw environmentResetError();
    if (SECRET_KEY_SET.has(envVarName))
      return this.persistSecret(envVarName, key).then(() => ({ success: true }));
    if (key) process.env[envVarName] = key;
    else delete process.env[envVarName];
    return { success: true };
  }

  // Snapshot, explicit prospective patch, durable write and publication share
  // one queue. Never stage a plaintext credential in the ambient environment.
  _commitEnvPatch(patch, { expectedEpoch = envWriteEpoch } = {}) {
    if (envWriteFenced || expectedEpoch !== envWriteEpoch)
      return Promise.reject(environmentResetError());
    return enqueueEnvWrite(async () => {
      if (expectedEpoch !== envWriteEpoch) throw environmentResetError();
      const values = Object.fromEntries(PERSISTED_KEYS.map((key) => [key, process.env[key] || ""]));
      Object.assign(values, patch);
      await this._writeEnvFile(path.join(app.getPath("userData"), ".env"), values);
      if (envWriteFenced || expectedEpoch !== envWriteEpoch) throw environmentResetError();
      for (const [key, value] of Object.entries(patch)) {
        if (value) process.env[key] = value;
        else delete process.env[key];
      }
    });
  }

  persistSecret(envVarName, value) {
    if (!SECRET_KEY_SET.has(envVarName))
      return Promise.reject(new Error(`${envVarName} is not a secret key`));
    const epoch = envWriteEpoch;
    // Keep committed-base capture and rollback inside this queue as well as
    // the durable write. Direct legacy callers cannot roll back a later save.
    return enqueueEnvWrite(async () => {
      const previous = process.env[envVarName] || "";
      const stale = () => envWriteFenced || epoch !== envWriteEpoch;
      try {
        await this._persistSecretPatch({ [envVarName]: value }, stale);
      } catch (error) {
        if (stale()) throw error;
        try {
          await this._persistSecretPatch({ [envVarName]: previous }, stale);
        } catch {
          if (stale()) throw error;
          let actual = "";
          try {
            actual = await this.readPersistedSecret(envVarName);
          } catch {
            this.markCredentialUnknown([envVarName]);
          }
          if (stale()) throw error;
          if (actual) process.env[envVarName] = actual;
          else delete process.env[envVarName];
        }
        throw error;
      }
    });
  }

  persistSecrets(values, { stale = () => false } = {}) {
    for (const key of Object.keys(values)) {
      if (!SECRET_KEY_SET.has(key)) throw new Error("Not a secret key");
    }
    return enqueueEnvWrite(() => this._persistSecretPatch(values, stale));
  }

  // Called only while the shared queue is owned; never enqueues recursively.
  // Native files cannot be renamed together, so withhold the entire RAM patch
  // until durable persistence succeeds or authority rollback/recovery finishes.
  async _persistSecretPatch(values, stale) {
    if (stale() || envWriteFenced) throw environmentResetError();
    if (this._encryptionAvailable()) {
      for (const [key, value] of Object.entries(values)) {
        if (stale() || envWriteFenced) throw environmentResetError();
        await this._saveSecretKey(key, value, { publish: false });
      }
      if (stale() || envWriteFenced) throw environmentResetError();
      // Clear stale fallback entries, preserving all unrelated .env lines.
      // Never mirror newly encrypted values into plaintext.
      await this._removeKeyLines(path.join(app.getPath("userData"), ".env"), Object.keys(values));
      if (stale() || envWriteFenced) throw environmentResetError();
      for (const key of Object.keys(values)) nativeCommittedKeys.add(key);
    } else {
      const prospective = Object.fromEntries(
        PERSISTED_KEYS.map((key) => [key, process.env[key] || ""])
      );
      Object.assign(prospective, values);
      await this._writeEnvFile(path.join(app.getPath("userData"), ".env"), prospective);
    }
    if (stale() || envWriteFenced) throw environmentResetError();
    for (const [key, value] of Object.entries(values)) {
      if (value) process.env[key] = value;
      else delete process.env[key];
    }
  }

  // Main-only recovery evidence after a failed native multi-file rollback.
  async readPersistedSecret(name) {
    if (!SECRET_KEY_SET.has(name)) throw new Error("Not a secret key");
    if (this._encryptionAvailable()) {
      try {
        return secretCrypto.decrypt(await fsPromises.readFile(this._getSecretFilePath(name))).value;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      nativeCommittedKeys.delete(name);
    }
    // Startup loads .env before native files, including partial migrations.
    // A missing encrypted file can therefore still have a durable fallback.
    try {
      const content = await fsPromises.readFile(path.join(app.getPath("userData"), ".env"), "utf8");
      return dotenv.parse(content)[name] || "";
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  }

  markCredentialUnknown(names) {
    for (const name of names) unknownPersistedKeys.add(name);
  }

  getLegacyVertexApiKey() {
    return this._getKey("GOOGLE_VERTEX_API_KEY");
  }

  getCortiClientId() {
    return this._getKey("CORTI_CLIENT_ID");
  }

  saveCortiClientId(key) {
    return this._saveKey("CORTI_CLIENT_ID", key);
  }

  getCortiClientSecret() {
    return this._getKey("CORTI_CLIENT_SECRET");
  }

  saveCortiClientSecret(key) {
    return this._saveKey("CORTI_CLIENT_SECRET", key);
  }

  getCustomTranscriptionKey() {
    return this._getKey("CUSTOM_TRANSCRIPTION_API_KEY");
  }

  saveCustomTranscriptionKey(key) {
    return this._saveKey("CUSTOM_TRANSCRIPTION_API_KEY", key);
  }

  getCleanupCustomKey() {
    // TODO: drop CUSTOM_REASONING_API_KEY fallback after 2 releases.
    return this._getKey("CUSTOM_CLEANUP_API_KEY") || this._getKey("CUSTOM_REASONING_API_KEY");
  }

  saveCleanupCustomKey(key) {
    delete process.env.CUSTOM_REASONING_API_KEY;
    return this._saveKey("CUSTOM_CLEANUP_API_KEY", key);
  }

  // Enterprise providers — AWS Bedrock
  getBedrockRegion() {
    return this._getKey("BEDROCK_REGION");
  }
  saveBedrockRegion(value) {
    return this._commitEnterpriseRoutePatch({ bedrockRegion: value });
  }
  getBedrockProfile() {
    return this._getKey("BEDROCK_PROFILE");
  }
  saveBedrockProfile(value) {
    return this._commitEnvPatch({ BEDROCK_PROFILE: value }).then(() => ({ success: true }));
  }
  getBedrockAccessKeyId() {
    return this._getKey("BEDROCK_ACCESS_KEY_ID");
  }
  saveBedrockAccessKeyId(key) {
    return this._saveKey("BEDROCK_ACCESS_KEY_ID", key);
  }
  getBedrockSecretAccessKey() {
    return this._getKey("BEDROCK_SECRET_ACCESS_KEY");
  }
  saveBedrockSecretAccessKey(key) {
    return this._saveKey("BEDROCK_SECRET_ACCESS_KEY", key);
  }
  getBedrockSessionToken() {
    return this._getKey("BEDROCK_SESSION_TOKEN");
  }
  saveBedrockSessionToken(key) {
    return this._saveKey("BEDROCK_SESSION_TOKEN", key);
  }

  // Enterprise providers — Azure OpenAI
  getAzureEndpoint() {
    return this._getKey("AZURE_OPENAI_ENDPOINT");
  }
  saveAzureEndpoint(value) {
    return this._commitEnterpriseRoutePatch({ azureEndpoint: value });
  }
  getAzureApiKey() {
    return this._getKey("AZURE_OPENAI_API_KEY");
  }
  saveAzureApiKey(key) {
    return this._saveKey("AZURE_OPENAI_API_KEY", key);
  }
  getAzureDeployment() {
    return this._getKey("AZURE_OPENAI_DEPLOYMENT");
  }
  saveAzureDeployment(value) {
    return this._saveKey("AZURE_OPENAI_DEPLOYMENT", value);
  }
  getAzureApiVersion() {
    return this._getKey("AZURE_OPENAI_API_VERSION");
  }
  saveAzureApiVersion(value) {
    return this._saveKey("AZURE_OPENAI_API_VERSION", value);
  }

  // Enterprise providers — GCP Vertex AI
  getVertexProject() {
    return this._getKey("VERTEX_PROJECT");
  }
  saveVertexProject(value) {
    return this._commitEnterpriseRoutePatch({ vertexProject: value });
  }
  getVertexLocation() {
    return this._getKey("VERTEX_LOCATION");
  }
  saveVertexLocation(value) {
    return this._commitEnterpriseRoutePatch({ vertexLocation: value });
  }
  getVertexApiKey() {
    return this._getKey("VERTEX_API_KEY");
  }
  saveVertexApiKey(key) {
    return this._saveKey("VERTEX_API_KEY", key);
  }

  getDictationKey() {
    return this._getKey("DICTATION_KEY");
  }

  saveDictationKey(key) {
    const result = this._saveKey("DICTATION_KEY", key);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getVoiceAgentKey() {
    const key = this._getKey("VOICE_AGENT_KEY");
    if (key) return key;
    // The chat-agent window is gone; its hotkey now opens the assistant by voice.
    const legacy = this._getKey("CHAT_AGENT_KEY");
    if (legacy) {
      this.saveVoiceAgentKey(legacy);
      delete process.env.CHAT_AGENT_KEY;
    }
    return legacy;
  }

  saveVoiceAgentKey(key) {
    const result = this._saveKey("VOICE_AGENT_KEY", key);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getTranslationKey() {
    return this._getKey("TRANSLATION_KEY");
  }

  saveTranslationKey(key) {
    const result = this._saveKey("TRANSLATION_KEY", key);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getMeetingKey() {
    return this._getKey("MEETING_KEY");
  }

  saveMeetingKey(key) {
    const result = this._saveKey("MEETING_KEY", key);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getActivationMode() {
    const mode = this._getKey("ACTIVATION_MODE");
    return mode === "push" ? "push" : "tap";
  }

  saveActivationMode(mode) {
    const validMode = mode === "push" ? "push" : "tap";
    const result = this._saveKey("ACTIVATION_MODE", validMode);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getFloatingIconAutoHide() {
    return this._getKey("FLOATING_ICON_AUTO_HIDE") === "true";
  }

  saveFloatingIconAutoHide(enabled) {
    const result = this._saveKey("FLOATING_ICON_AUTO_HIDE", String(enabled));
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getStartMinimized() {
    return this._getKey("START_MINIMIZED") === "true";
  }

  saveStartMinimized(enabled) {
    const result = this._saveKey("START_MINIMIZED", String(enabled));
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getPanelStartPosition() {
    const v = this._getKey("PANEL_START_POSITION");
    if (v === "bottom-right" || v === "center" || v === "bottom-left") return v;
    return "bottom-right";
  }

  savePanelStartPosition(position) {
    const result = this._saveKey("PANEL_START_POSITION", position);
    this.saveAllKeysToEnvFile().catch(() => {});
    return result;
  }

  getUiLanguage(fallbackLanguage = "") {
    const language = this._getKey("UI_LANGUAGE") || fallbackLanguage;
    return language ? normalizeUiLanguage(language) : "";
  }

  saveUiLanguage(language) {
    const normalized = normalizeUiLanguage(language);
    const result = this._saveKey("UI_LANGUAGE", normalized);
    this.saveAllKeysToEnvFile().catch(() => {});
    return { ...result, language: normalized };
  }

  async saveAllKeysToEnvFile({ expectedEpoch } = {}) {
    if (envWriteFenced) throw environmentResetError();
    const epoch = expectedEpoch ?? envWriteEpoch;
    if (epoch !== envWriteEpoch) throw environmentResetError();
    const envPath = path.join(app.getPath("userData"), ".env");
    const written = await this._writeEnvFileAtomic(envPath);
    if (!written || envWriteFenced || epoch !== envWriteEpoch) throw environmentResetError();
    dotenv.config({ path: envPath, quiet: true });
    return { success: true, path: envPath };
  }

  async clearAllPersistedData() {
    if (envWriteFenced) throw environmentResetError();
    envWriteFenced = true;
    envWriteEpoch += 1;
    try {
      await envWriteQueue.catch(() => {});
      for (const envVarName of PERSISTED_KEYS) delete process.env[envVarName];
      nativeCommittedKeys.clear();
      delete process.env.CUSTOM_REASONING_API_KEY;
      const erased = await Promise.allSettled([
        fsPromises.rm(path.join(app.getPath("userData"), ".env"), { force: true }),
        fsPromises.rm(path.join(app.getPath("userData"), ".env.tmp"), { force: true }),
        fsPromises.rm(this._getSecureKeysDir(), { recursive: true, force: true }),
      ]);
      const failures = erased.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((result) => result.reason),
          "Environment erase failed"
        );
      }
      unknownPersistedKeys.clear();
      return { success: true };
    } finally {
      envWriteFenced = false;
    }
  }

  removeKeyFromEnvFile(key) {
    const envPath = path.join(app.getPath("userData"), ".env");
    return enqueueEnvWrite(() => this._removeKeyLine(envPath, key));
  }

  getEnvWriteEpoch() {
    return envWriteEpoch;
  }

  drainEnvWrites() {
    return envWriteQueue.catch(() => {});
  }

  getEnterpriseRouteSettings() {
    return {
      bedrockRegion: this.getBedrockRegion() || "us-east-1",
      azureEndpoint: this.getAzureEndpoint(),
      vertexProject: this.getVertexProject(),
      vertexLocation: this.getVertexLocation() || "us-central1",
      vertexAuthSource: this.getVertexAuthSource(),
    };
  }

  saveEnterpriseRoutePatch(patch, { expected } = {}) {
    // Renderer/public callers must compare the complete committed base.
    // Only the internal startup migration calls _commitEnterpriseRoutePatch
    // without expected (and supplies its captured epoch instead).
    if (!isEnterpriseRouteSettings(expected))
      throw new Error("Expected enterprise route settings are required");
    return this._commitEnterpriseRoutePatch(patch, { expected });
  }

  // Main-only transaction used by startup migration and Task 6's public IPC.
  async _commitEnterpriseRoutePatch(patch, { expected, expectedEpoch } = {}) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw new Error("Invalid enterprise route patch");
    for (const [key, value] of Object.entries(patch)) {
      if (!ENTERPRISE_ROUTE_KEYS.includes(key) || typeof value !== "string")
        throw new Error("Invalid enterprise route patch");
      if (/[\r\n\0]/.test(value)) throw new Error("Invalid enterprise route value");
      if (key === "vertexAuthSource" && value !== "adc" && value !== "apiKey")
        throw new Error("Invalid Vertex auth source");
    }
    if (Object.keys(patch).length === 0) throw new Error("Enterprise route patch is empty");
    if (expected !== undefined && !isEnterpriseRouteSettings(expected))
      throw new Error("Invalid expected enterprise route settings");
    const epoch = expectedEpoch ?? envWriteEpoch;
    if (envWriteFenced || epoch !== envWriteEpoch) throw environmentResetError();

    let outcome;
    const envPath = path.join(app.getPath("userData"), ".env");
    const written = await enqueueEnvWrite(async () => {
      if (envWriteFenced || epoch !== envWriteEpoch) throw environmentResetError();
      const current = this.getEnterpriseRouteSettings();
      if (expected && ENTERPRISE_ROUTE_KEYS.some((key) => current[key] !== expected[key])) {
        outcome = { success: false, conflict: true, current };
        return;
      }
      const next = { ...current, ...patch };
      const explicitValues = Object.fromEntries(
        ENTERPRISE_ROUTE_KEYS.map((key) => [ENTERPRISE_ROUTE_ENV_KEYS[key], next[key]])
      );
      await this._writeEnvFile(envPath, explicitValues);
      // This check and the complete RAM commit stay inside the shared queue:
      // a following save-all cannot snapshot stale values after the rename.
      if (envWriteFenced || epoch !== envWriteEpoch) throw environmentResetError();
      for (const key of ENTERPRISE_ROUTE_KEYS) {
        const envKey = ENTERPRISE_ROUTE_ENV_KEYS[key];
        if (next[key]) process.env[envKey] = next[key];
        else delete process.env[envKey];
      }
      outcome = { success: true, current: next };
    });
    if (!written || envWriteFenced || epoch !== envWriteEpoch) throw environmentResetError();
    return outcome;
  }

  getVertexAuthSource() {
    const source = process.env.VERTEX_AUTH_SOURCE;
    return source === "adc" || source === "apiKey" ? source : null;
  }

  // Main-only. The shared transaction validates and persists the explicit
  // prospective tuple before changing process.env. An expected epoch is
  // supplied only by startup migration.
  saveVertexAuthSource(source, { expectedEpoch } = {}) {
    if (source !== "adc" && source !== "apiKey") throw new Error("Invalid Vertex auth source");
    return this._commitEnterpriseRoutePatch(
      { vertexAuthSource: source },
      { expectedEpoch } // migration only; omitted by public IPC
    ).then(() => ({ success: true }));
  }

  _removeKeyLine(envPath, key) {
    return this._removeKeyLines(envPath, [key]);
  }

  async _removeKeyLines(envPath, keys) {
    let content;
    try {
      content = await fsPromises.readFile(envPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const keyLine = new RegExp(`^\\s*(?:export\\s+)?(?:${keys.join("|")})\\s*=`);
    const lines = content.split("\n");
    const kept = lines.filter((line) => !keyLine.test(line));
    if (kept.length === lines.length) return;
    const tmpPath = `${envPath}.tmp`;
    await fsPromises.writeFile(tmpPath, kept.join("\n"), "utf8");
    await fsPromises.rename(tmpPath, envPath);
  }
}

// Generate the uniform BYOK key accessors (getOpenAIKey/saveOpenAIKey/…) from
// the shared manifest so each provider is defined in exactly one place.
for (const k of BYOK_API_KEYS) {
  EnvironmentManager.prototype[k.get] = function () {
    return this._getKey(k.env);
  };
  EnvironmentManager.prototype[k.save] = function (key) {
    return this._saveKey(k.env, key);
  };
}

module.exports = EnvironmentManager;
