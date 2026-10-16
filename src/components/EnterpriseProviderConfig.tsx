import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { saveSecret as saveStoredSecret, useSettingsStore } from "../stores/settingsStore";
import { adjustBedrockModelForRegion } from "../utils/bedrockRegions";
import ApiKeyInput from "./ui/ApiKeyInput";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface EnterpriseProviderConfigProps {
  provider: "bedrock" | "azure" | "vertex";
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
}

function Field({
  label,
  value,
  onChange,
  onCommit,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => Promise<void>;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        dir="ltr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={
          onCommit
            ? (event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onCommit();
                }
              }
            : undefined
        }
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-8 text-sm"
        autoComplete="off"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

/** Direct credentials are saved in main; renderer state contains only presence markers. */
export default function EnterpriseProviderConfig({
  provider,
  reasoningModel,
  setReasoningModel,
}: EnterpriseProviderConfigProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [profileDraft, setProfileDraft] = useState(settings.bedrockProfile);
  const [profileFailed, setProfileFailed] = useState(false);
  const profileDraftRef = useRef(profileDraft);
  const profileDirty = useRef(false);
  const profileRevision = useRef(0);
  const profilePending = useRef<Promise<void>>(Promise.resolve());
  const profileSubmitted = useRef<{
    value: string;
    revision: { current: number };
    promise: Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (!profileDirty.current) {
      profileDraftRef.current = settings.bedrockProfile;
      setProfileDraft(settings.bedrockProfile);
    }
  }, [settings.bedrockProfile]);

  const editProfile = (value: string) => {
    profileRevision.current += 1;
    profileDirty.current = true;
    profileDraftRef.current = value;
    setProfileDraft(value);
    setProfileFailed(false);
    setConnected(false);
  };
  const commitProfile = (): Promise<void> => {
    const value = profileDraftRef.current;
    const revision = profileRevision.current;
    if (!profileSubmitted.current && value === settings.bedrockProfile) return Promise.resolve();
    if (profileSubmitted.current?.value === value) {
      // Only the latest queued submission can coalesce. A new explicit submit
      // after intervening edits owns that ACK; an unsent edit does not.
      profileSubmitted.current.revision.current = revision;
      return profileSubmitted.current.promise;
    }
    const submittedRevision = { current: revision };
    // A blur during an earlier ACK queues the later draft. Each completion
    // belongs to its edit revision and cannot overwrite a newer draft/error.
    const saving = profilePending.current.then(async () => {
      const saved = await settings.setBedrockProfile(value);
      if (profileRevision.current === submittedRevision.current) {
        profileDirty.current = !saved;
        setProfileFailed(!saved);
      }
    });
    profilePending.current = saving;
    profileSubmitted.current = { value, revision: submittedRevision, promise: saving };
    void saving.then(() => {
      if (profileSubmitted.current?.promise === saving) profileSubmitted.current = null;
    });
    return saving;
  };

  // Main stores the credential and acknowledges it; ApiKeyInput shows the
  // outcome, and renderer state only ever holds the presence sentinel.
  const saveSecret = (
    field:
      | "bedrockAccessKeyId"
      | "bedrockSecretAccessKey"
      | "bedrockSessionToken"
      | "azureApiKey"
      | "vertexApiKey",
    value: string
  ) => {
    setError("");
    setConnected(false);
    return saveStoredSecret(field, value);
  };

  const testConnection = async () => {
    setBusy(true);
    setError("");
    setConnected(false);
    try {
      await window.electronAPI.personalInference.textGenerate({
        requestId: crypto.randomUUID(),
        provider,
        model: reasoningModel,
        credentialRef: provider,
        inferenceScope: "noteFormatting",
        messages: [{ role: "user", content: "Reply with hello." }],
        maxTokens: 32,
        timeoutMs: 30000,
      });
      setConnected(true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {provider === "bedrock" && (
        <>
          <Field
            label={t("reasoning.enterprise.region")}
            value={settings.bedrockRegion}
            onChange={(region) => {
              settings.setBedrockRegion(region);
              setReasoningModel(adjustBedrockModelForRegion(reasoningModel, region));
            }}
          />
          <Field
            label={t("reasoning.enterprise.profile")}
            value={profileDraft}
            onChange={editProfile}
            onCommit={commitProfile}
            error={profileFailed ? t("reasoning.enterprise.profileSaveFailed") : undefined}
          />
          <p className="text-xs text-muted-foreground">{t("personal.directAwsCredentials")}</p>
          <ApiKeyInput
            label={t("reasoning.enterprise.accessKeyId")}
            masked={false}
            placeholder="AKIA…"
            apiKey={settings.bedrockAccessKeyId}
            setApiKey={(value) => saveSecret("bedrockAccessKeyId", value)}
          />
          <ApiKeyInput
            label={t("reasoning.enterprise.secretAccessKey")}
            apiKey={settings.bedrockSecretAccessKey}
            setApiKey={(value) => saveSecret("bedrockSecretAccessKey", value)}
          />
          <ApiKeyInput
            label={t("reasoning.enterprise.sessionToken")}
            apiKey={settings.bedrockSessionToken}
            setApiKey={(value) => saveSecret("bedrockSessionToken", value)}
          />
        </>
      )}
      {provider === "azure" && (
        <>
          <Field
            label={t("reasoning.enterprise.endpoint")}
            value={settings.azureEndpoint}
            onChange={settings.setAzureEndpoint}
          />
          <p className="text-xs text-muted-foreground">
            {t("reasoning.enterprise.azure.endpointHelp")}
          </p>
          <Field
            label={t("reasoning.enterprise.apiVersion")}
            value={settings.azureApiVersion}
            onChange={settings.setAzureApiVersion}
          />
          <ApiKeyInput
            apiKey={settings.azureApiKey}
            setApiKey={(value) => saveSecret("azureApiKey", value)}
          />
        </>
      )}
      {provider === "vertex" && (
        <>
          <Field
            label={t("reasoning.enterprise.projectId")}
            value={settings.vertexProject}
            onChange={settings.setVertexProject}
          />
          <Field
            label={t("reasoning.enterprise.location")}
            value={settings.vertexLocation}
            onChange={settings.setVertexLocation}
          />
          <p className="text-xs text-muted-foreground">
            {t("reasoning.enterprise.vertex.adcHelp")}
          </p>
          <ApiKeyInput
            apiKey={settings.vertexApiKey}
            setApiKey={(value) => saveSecret("vertexApiKey", value)}
            helpText={t("reasoning.enterprise.vertex.apikeyHelp")}
          />
        </>
      )}
      <Field
        label={t(
          provider === "azure"
            ? "reasoning.enterprise.deploymentName"
            : "reasoning.enterprise.customModelId"
        )}
        value={reasoningModel}
        onChange={setReasoningModel}
      />
      <Button
        variant="outline"
        disabled={busy || !reasoningModel.trim()}
        onClick={() => void testConnection()}
      >
        {t(
          busy
            ? "reasoning.enterprise.testing"
            : connected
              ? "reasoning.enterprise.testSuccess"
              : "reasoning.enterprise.testConnection"
        )}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
