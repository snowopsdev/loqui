import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { applyImportedModels, type ModelDefinition } from "../models/ModelRegistry";
import { LOCAL_MODELS_CHANGED_EVENT } from "../hooks/useModelDownload";
import { ProviderTabs } from "./ui/ProviderTabs";
import { DownloadProgressBar } from "./ui/DownloadProgressBar";
import { ConfirmDialog } from "./ui/dialog";
import ModelCardList, { type ModelCardOption } from "./ui/ModelCardList";
import { useDialogs } from "../hooks/useDialogs";
import { useModelDownload, type ModelType } from "../hooks/useModelDownload";
import { MODEL_PICKER_COLORS, type ColorScheme } from "../utils/modelPickerStyles";
import { getProviderIcon, isMonochromeProvider } from "../utils/providerIcons";

export interface LocalModel {
  id: string;
  name: string;
  size: string;
  sizeBytes?: number;
  description: string;
  descriptionKey?: string;
  specUrl?: string;
  isDownloaded?: boolean;
  downloaded?: boolean;
  recommended?: boolean;
  imported?: boolean;
  loadStatus?: "untested" | "ready" | "failed";
  loadError?: string;
}

export interface LocalProvider {
  id: string;
  name: string;
  models: LocalModel[];
}

interface LocalModelPickerProps {
  providers: LocalProvider[];
  selectedModel: string;
  selectedProvider: string;
  onModelSelect: (modelId: string) => void;
  onProviderSelect: (providerId: string) => void;
  modelType: ModelType;
  colorScheme?: Exclude<ColorScheme, "blue">;
  className?: string;
  onDownloadComplete?: () => void;
}

export default function LocalModelPicker({
  providers,
  selectedModel,
  selectedProvider,
  onModelSelect,
  onProviderSelect,
  modelType,
  colorScheme = "purple",
  className = "",
  onDownloadComplete,
}: LocalModelPickerProps) {
  const { t } = useTranslation();
  const [downloadedModels, setDownloadedModels] = useState<Set<string>>(new Set());
  const loadDownloadedModelsRequestRef = useRef(0);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [importedModels, setImportedModels] = useState<LocalModel[]>([]);
  const [modelOperation, setModelOperation] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const effectiveProviders = useMemo(
    () =>
      modelType === "llm"
        ? [
            ...providers.filter((provider) => provider.id !== "imported"),
            {
              id: "imported",
              name: t("localModels.importedProvider"),
              models: importedModels,
            },
          ]
        : providers,
    [providers, modelType, importedModels, t]
  );

  const knownModelIds = useMemo(
    () =>
      new Set(effectiveProviders.flatMap((provider) => provider.models.map((model) => model.id))),
    [effectiveProviders]
  );

  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();
  const styles = useMemo(() => MODEL_PICKER_COLORS[colorScheme], [colorScheme]);

  const loadDownloadedModels = useCallback(async () => {
    const requestId = ++loadDownloadedModelsRequestRef.current;

    try {
      let downloaded = new Set<string>();
      if (modelType === "whisper") {
        const result = await window.electronAPI?.listWhisperModels();
        if (result?.success) {
          downloaded = new Set(
            result.models
              .filter((m: { downloaded?: boolean }) => m.downloaded)
              .map((m: { model: string }) => m.model)
          );
        }
      } else if (modelType === "parakeet") {
        const result = await window.electronAPI?.listParakeetModels();
        if (result?.success) {
          downloaded = new Set(
            result.models
              .filter((m: { downloaded?: boolean }) => m.downloaded)
              .map((m: { model: string }) => m.model)
          );
        }
      } else {
        const result = await window.electronAPI?.modelGetAll?.();
        if (result && Array.isArray(result)) {
          if (requestId === loadDownloadedModelsRequestRef.current) {
            const imports = result.filter((model) => model.imported) as ModelDefinition[];
            setImportedModels(imports);
            applyImportedModels(imports);
          }
          downloaded = new Set(
            result
              .filter((m: { isDownloaded?: boolean }) => m.isDownloaded)
              .map((m: { id: string }) => m.id)
          );
        }
      }
      if (requestId === loadDownloadedModelsRequestRef.current) {
        setDownloadedModels(downloaded);
        setInventoryLoaded(true);
        return downloaded;
      }
      return null;
    } catch (error) {
      console.error("Failed to load downloaded models:", error);
      return null;
    }
  }, [modelType]);

  useEffect(() => {
    void loadDownloadedModels();
    const reload = () => {
      void loadDownloadedModels();
    };
    window.addEventListener(LOCAL_MODELS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(LOCAL_MODELS_CHANGED_EVENT, reload);
  }, [loadDownloadedModels]);

  useEffect(() => {
    if (
      inventoryLoaded &&
      selectedModel &&
      knownModelIds.has(selectedModel) &&
      !downloadedModels.has(selectedModel)
    ) {
      onModelSelect("");
    }
  }, [inventoryLoaded, selectedModel, knownModelIds, downloadedModels, onModelSelect]);

  const testModel = useCallback(
    async (modelId: string, selectWhenReady = false) => {
      setModelOperation("testing");
      setOperationMessage(null);
      try {
        const result = await window.electronAPI.modelTestLoad(modelId);
        if (result.success) {
          setOperationMessage(t("localModels.ready"));
          if (selectWhenReady) {
            onProviderSelect("imported");
            onModelSelect(modelId);
          }
        } else if (!result.canceled) {
          setOperationMessage(result.error || t("localModels.loadFailed"));
        }
      } catch (error) {
        setOperationMessage(error instanceof Error ? error.message : t("localModels.loadFailed"));
      } finally {
        setModelOperation(null);
        await loadDownloadedModels();
        window.dispatchEvent(new Event(LOCAL_MODELS_CHANGED_EVENT));
      }
    },
    [loadDownloadedModels, onModelSelect, onProviderSelect, t]
  );

  const importModel = useCallback(async () => {
    setModelOperation("importing");
    setOperationMessage(null);
    try {
      const result = await window.electronAPI.modelImportGguf();
      if (result.success && result.modelId) {
        await loadDownloadedModels();
        onProviderSelect("imported");
        await testModel(result.modelId, true);
      } else if (!result.canceled) {
        setOperationMessage(result.error || t("localModels.importFailed"));
      }
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : t("localModels.importFailed"));
    } finally {
      setModelOperation(null);
    }
  }, [loadDownloadedModels, onProviderSelect, testModel, t]);

  const selectModel = useCallback(
    (modelId: string) => {
      if (modelOperation) return;
      const imported = importedModels.find((model) => model.id === modelId);
      if (imported && imported.loadStatus !== "ready") {
        void testModel(modelId, true);
        return;
      }
      onModelSelect(modelId);
    },
    [importedModels, onModelSelect, testModel, modelOperation]
  );

  const handleDownloadComplete = useCallback(async () => {
    await loadDownloadedModels();
    await onDownloadComplete?.();
  }, [loadDownloadedModels, onDownloadComplete]);

  const {
    downloads,
    downloadModel,
    deleteModel,
    isDownloadingModel,
    cancelDownload,
    isCancellingModel,
  } = useModelDownload({
    modelType,
    onDownloadComplete: handleDownloadComplete,
    onModelsCleared: loadDownloadedModels,
  });

  const allModels = useMemo(
    () => effectiveProviders.flatMap((provider) => provider.models),
    [effectiveProviders]
  );
  const selectionStateRef = useRef({ selectedModel, downloadedModels, knownModelIds });

  useEffect(() => {
    selectionStateRef.current = { selectedModel, downloadedModels, knownModelIds };
  }, [selectedModel, downloadedModels, knownModelIds]);

  const handleDownload = useCallback(
    (modelId: string) => {
      const selectedWhenStarted = selectionStateRef.current.selectedModel;

      downloadModel(modelId, (downloadedId) => {
        const {
          selectedModel: current,
          downloadedModels: downloaded,
          knownModelIds: known,
        } = selectionStateRef.current;
        if (current !== selectedWhenStarted) return;

        const selectionGone = known.has(current) && !downloaded.has(current);
        if (!current || selectionGone) {
          onModelSelect(downloadedId);
        }
      });
    },
    [downloadModel, onModelSelect]
  );

  const handleDelete = useCallback(
    (modelId: string) => {
      if (modelOperation) return;
      showConfirmDialog({
        title: t("transcription.deleteModel.title"),
        description: t("transcription.deleteModel.description"),
        onConfirm: () => deleteModel(modelId, loadDownloadedModels),
        variant: "destructive",
      });
    },
    [showConfirmDialog, deleteModel, loadDownloadedModels, t, modelOperation]
  );

  const currentProvider = effectiveProviders.find((p) => p.id === selectedProvider);
  const models = useMemo(() => currentProvider?.models || [], [currentProvider?.models]);
  const activeModels = allModels.filter((model) => downloads[model.id]);

  return (
    <div className={className}>
      <ProviderTabs
        providers={effectiveProviders}
        selectedId={selectedProvider}
        onSelect={onProviderSelect}
        colorScheme={colorScheme}
        wrap
      />

      {modelType === "llm" && (
        <div className="my-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void importModel()}
              disabled={Boolean(modelOperation)}
            >
              {t("localModels.importGguf")}
            </Button>
            {selectedModel && downloadedModels.has(selectedModel) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void testModel(selectedModel)}
                disabled={Boolean(modelOperation)}
              >
                {t("localModels.testLoad")}
              </Button>
            )}
            {modelOperation && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void window.electronAPI.modelCancelLoadTest()}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("localModels.importHint")}</p>
          {modelOperation && (
            <p role="status" className="text-xs text-muted-foreground">
              {t(modelOperation === "testing" ? "localModels.testing" : "localModels.importing")}
            </p>
          )}
          {operationMessage && (
            <p role="status" className="text-xs">
              {operationMessage}
            </p>
          )}
        </div>
      )}

      {activeModels.length > 0 && (
        <div className="space-y-2">
          {activeModels.map((model) => {
            const status = downloads[model.id];
            return (
              <DownloadProgressBar
                key={model.id}
                modelName={model.name}
                progress={{
                  percentage: status.progress,
                  downloadedBytes: status.downloadedBytes,
                  totalBytes: status.totalBytes,
                }}
                isInstalling={status.phase === "installing"}
              />
            );
          })}
        </div>
      )}

      <div className="mt-2">
        <h5 className={`${styles.header} mb-2`}>{t("common.availableModels")}</h5>

        <ModelCardList
          models={models.map((model): ModelCardOption => ({
            value: model.id,
            label: model.name,
            description: model.imported
              ? `${model.size} · ${t(`localModels.status.${model.loadStatus || "untested"}`)}`
              : model.size,
            specUrl: model.specUrl,
            icon: getProviderIcon(selectedProvider),
            invertInDark: isMonochromeProvider(selectedProvider),
            recommended: model.recommended,
            isDownloaded: downloadedModels.has(model.id) || model.isDownloaded || model.downloaded,
            isDownloading: isDownloadingModel(model.id),
            isCancelling: isCancellingModel(model.id),
          }))}
          selectedModel={selectedModel}
          onModelSelect={selectModel}
          onDownload={handleDownload}
          onDelete={handleDelete}
          onCancelDownload={cancelDownload}
          colorScheme={colorScheme}
        />
      </div>

      {models
        .filter((model) => model.loadError)
        .map((model) => (
          <p key={model.id} role="status" className="mt-2 text-xs text-destructive">
            {model.name}: {model.loadError}
          </p>
        ))}

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />
    </div>
  );
}
