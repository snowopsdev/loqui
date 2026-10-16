import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingsPatch } from "../lib/providerSwitchPlans";
import { saveSecret as saveStoredSecret, useSettingsStore } from "../stores/settingsStore";
import ApiKeyInput from "./ui/ApiKeyInput";
import { BIDI_VALUE_TOKEN, BidiInterpolatedText } from "./ui/BidiInterpolatedText";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type EnterpriseProvider = "bedrock" | "azure" | "vertex";
type RouteField =
  "bedrockRegion" | "azureEndpoint" | "vertexProject" | "vertexLocation" | "vertexAuthSource";
type Translate = (key: string, options?: Record<string, unknown>) => string;
export interface VerifyTarget {
  recipientToken?: string;
  hosts: string[];
  fields: string[];
}

interface EnterpriseProviderConfigProps {
  provider: EnterpriseProvider;
  reasoningModel: string;
  /** The deployment or model id, committed through the route planner (onCommit / the staged draft). */
  onSelectModel: (model: string) => void;
  /**
   * R2-1: the route fields main sends requests with (main.js:447-457). The active
   * editor passes requestRoutePatch for its route; the staged panel passes
   * stageDraftSetup. This component never writes them itself.
   */
  onRoutePatch: (patch: SettingsPatch) => void;
  /** Staged setup shown over the live values (staged panel only). */
  pending?: SettingsPatch;
  /** Default true. The staged panel hides it: nothing is committed there to test. */
  testConnection?: boolean;
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

// Typed text stays local until the field is left or Enter is pressed; then
// it commits once. Never a write per keystroke.
function DraftField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (!dirty.current || value === draftRef.current) {
      dirty.current = false;
      setDraft(value);
    }
  }, [value]);
  const commit = () => {
    if (!touched.current) return;
    touched.current = false;
    // Even returning to the committed value is explicit intent: it must
    // supersede an earlier waiting route patch for this editor.
    onCommit(draft.trim());
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        dir="ltr"
        value={draft}
        onChange={(event) => {
          dirty.current = true;
          touched.current = true;
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="h-8 text-sm"
        autoComplete="off"
      />
    </div>
  );
}

// R2-6: the button names the host main will send to and the credential
// fields it sends, both from main's describeVerify (Task 11). Main computes
// them from the committed configuration the test request reads.
// Public pure disclosure helper is part of the Task9 interface.
// eslint-disable-next-line react-refresh/only-export-components
export function enterpriseTestDisclosure(target: VerifyTarget | null, t: Translate): string {
  const host = target?.hosts[0];
  if (!host || !target?.recipientToken) return t("reasoning.enterprise.testHostUnknown");
  if (target.fields.length === 0) return t("reasoning.enterprise.testSendsNoKey", { host });
  const fields = target.fields.map((field) => t(`reasoning.enterprise.field.${field}`)).join(", ");
  return t("reasoning.enterprise.testSends", { host, fields });
}

/** Direct credentials are saved in main; renderer state contains only presence markers. */
export default function EnterpriseProviderConfig({
  provider,
  reasoningModel,
  onSelectModel,
  onRoutePatch,
  pending,
  testConnection = true,
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

  const [target, setTarget] = useState<VerifyTarget | null>(null);
  const [credentialEvents, setCredentialEvents] = useState(0);
  const value = (field: RouteField): string =>
    String((pending as Record<string, unknown> | undefined)?.[field] ?? settings[field] ?? "");
  const routeField = (field: RouteField) => (next: string) =>
    onRoutePatch({ [field]: next } as SettingsPatch);

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

  // Re-query whenever the committed configuration the test reads changes
  // (a staged edit does not change it until Apply), and on credentials-changed.
  const committed =
    provider === "azure"
      ? settings.azureEndpoint
      : provider === "bedrock"
        ? `${settings.bedrockRegion}|${settings.bedrockProfile}`
        : `${settings.vertexProject}|${settings.vertexLocation}|${settings.vertexAuthSource}`;
  useEffect(
    () => window.electronAPI?.credentials?.onChanged?.(() => setCredentialEvents((n) => n + 1)),
    []
  );
  useEffect(() => {
    if (!testConnection) return;
    let current = true;
    setTarget(null);
    const describe = window.electronAPI?.keyring?.describeVerify;
    if (!describe) return;
    window.electronAPI.keyring
      .describeVerify(provider, { model: reasoningModel })
      .then((next) => {
        if (current) setTarget(next);
      })
      .catch(() => {
        if (current) setTarget({ hosts: [], fields: [] });
      });
    return () => {
      current = false;
    };
  }, [provider, committed, credentialEvents, testConnection, reasoningModel]);

  const host = target?.hosts[0] ?? null;
  const testConnectionNow = async () => {
    setBusy(true);
    setError("");
    setConnected(false);
    try {
      if (!target?.recipientToken || !window.electronAPI.keyring?.verifyConnection) return;
      await window.electronAPI.keyring.verifyConnection({
        recipientToken: target.recipientToken,
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
          {/* The region picks the receiving host; Task 6 adjusts the model's geo prefix in the same patch. */}
          <DraftField
            label={t("reasoning.enterprise.region")}
            value={value("bedrockRegion")}
            onCommit={routeField("bedrockRegion")}
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
          <DraftField
            label={t("reasoning.enterprise.endpoint")}
            value={value("azureEndpoint")}
            onCommit={routeField("azureEndpoint")}
          />
          <p className="text-xs text-muted-foreground">
            {t("reasoning.enterprise.azure.endpointHelp")}
          </p>
          <DraftField
            label={t("reasoning.enterprise.apiVersion")}
            value={settings.azureApiVersion}
            onCommit={settings.setAzureApiVersion}
          />
          <ApiKeyInput
            apiKey={settings.azureApiKey}
            setApiKey={(value) => saveSecret("azureApiKey", value)}
          />
        </>
      )}
      {provider === "vertex" && (
        <>
          <DraftField
            label={t("reasoning.enterprise.projectId")}
            value={value("vertexProject")}
            onCommit={routeField("vertexProject")}
          />
          <DraftField
            label={t("reasoning.enterprise.location")}
            value={value("vertexLocation")}
            onCommit={routeField("vertexLocation")}
          />
          <label className="block space-y-1 text-sm">
            <span>{t("reasoning.enterprise.vertex.authSource")}</span>
            <select
              aria-label={t("reasoning.enterprise.vertex.authSource")}
              data-route-field="vertexAuthSource"
              value={value("vertexAuthSource") || "adc"}
              onChange={(event) => routeField("vertexAuthSource")(event.currentTarget.value)}
              className="h-9 w-full rounded-md border bg-background px-3"
            >
              <option value="adc">{t("reasoning.enterprise.vertex.authSourceAdc")}</option>
              <option value="apiKey">{t("reasoning.enterprise.vertex.authSourceApiKey")}</option>
            </select>
          </label>
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
      <DraftField
        label={t(
          provider === "azure"
            ? "reasoning.enterprise.deploymentName"
            : "reasoning.enterprise.customModelId"
        )}
        value={reasoningModel}
        onCommit={onSelectModel}
      />
      {testConnection && (
        <>
          <Button
            variant="outline"
            data-action="enterprise-test"
            data-host={host ?? ""}
            title={enterpriseTestDisclosure(target, t)}
            disabled={
              busy ||
              !reasoningModel.trim() ||
              !host ||
              !target?.recipientToken ||
              !window.electronAPI.keyring?.verifyConnection
            }
            onClick={() => void testConnectionNow()}
          >
            {busy ? (
              t("reasoning.enterprise.testing")
            ) : connected ? (
              t("reasoning.enterprise.testSuccess")
            ) : host ? (
              <BidiInterpolatedText
                text={t("reasoning.enterprise.testConnectionAt", { host: BIDI_VALUE_TOKEN })}
                value={host}
              />
            ) : (
              t("reasoning.enterprise.testConnection")
            )}
          </Button>
          <p className="text-xs text-muted-foreground">{enterpriseTestDisclosure(target, t)}</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
