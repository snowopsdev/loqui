import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
        className="h-8 text-sm"
        autoComplete="off"
      />
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
  const saveSecret = async (
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
    try {
      if (field === "azureApiKey" || field === "vertexApiKey") {
        await window.electronAPI.personalInference.credentialSave(
          field === "azureApiKey" ? "azure" : "vertex",
          value
        );
      } else {
        const method =
          field === "bedrockAccessKeyId"
            ? "saveBedrockAccessKeyId"
            : field === "bedrockSecretAccessKey"
              ? "saveBedrockSecretAccessKey"
              : "saveBedrockSessionToken";
        const save = window.electronAPI[method];
        if (!save) throw new Error(t("reasoning.enterprise.testFailed"));
        await save(value);
      }
      useSettingsStore.setState({ [field]: value ? "__stored__" : "" });
    } catch (error) {
      setError((error as Error).message);
    }
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
            value={settings.bedrockProfile}
            onChange={settings.setBedrockProfile}
          />
          <p className="text-xs text-muted-foreground">{t("personal.directAwsCredentials")}</p>
          <ApiKeyInput
            label={t("reasoning.enterprise.accessKeyId")}
            apiKey={settings.bedrockAccessKeyId}
            setApiKey={(value) => void saveSecret("bedrockAccessKeyId", value)}
          />
          <ApiKeyInput
            label={t("reasoning.enterprise.secretAccessKey")}
            apiKey={settings.bedrockSecretAccessKey}
            setApiKey={(value) => void saveSecret("bedrockSecretAccessKey", value)}
          />
          <ApiKeyInput
            label={t("reasoning.enterprise.sessionToken")}
            apiKey={settings.bedrockSessionToken}
            setApiKey={(value) => void saveSecret("bedrockSessionToken", value)}
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
            setApiKey={(value) => void saveSecret("azureApiKey", value)}
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
            setApiKey={(value) => void saveSecret("vertexApiKey", value)}
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
