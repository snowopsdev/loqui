import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { createExternalLinkHandler } from "../../utils/externalLinks";
import { formatDecimalBytes } from "../../utils/formatBytes";
import { cn } from "../lib/utils";
import { Download, Trash2, X } from "../icons";
import { Button } from "./button";
import {
  estimateRamBytes,
  estimateTiers,
  fitFor,
  sortForDisplay,
  visibleModels,
  type CartridgeModel,
} from "./cartridgeMath";
import { stepGrid } from "./rovingNav";

// The grid is always two columns, so the arrow-key model (stepGrid columns: 2)
// matches what is on screen.
const COLUMNS = 2;

export interface ModelCartridgeGridProps {
  label: string;
  models: CartridgeModel[];
  selectedId: string;
  totalMemoryBytes: number | null;
  /** Model id -> translated names of the tasks that already run on it. */
  usedBy?: Record<string, string[]>;
  /** Reading direction; defaults to the active UI language's. */
  dir?: "ltr" | "rtl";
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  onCancel?: (id: string) => void;
  onDelete?: (id: string) => void;
}

function Pips({ label, value }: { label: string; value: number }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span role="img" aria-label={t("cartridge.meter", { label, value })} className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={cn("h-2.5 w-1.5 rounded-sm", n <= value ? "bg-foreground/70" : "bg-border")}
          />
        ))}
      </span>
    </>
  );
}

export function ModelCartridgeGrid(props: ModelCartridgeGridProps) {
  const { t, i18n } = useTranslation();
  const baseId = useId();
  const [expanded, setExpanded] = useState(false);
  // null = nothing inside the grid has focus; the checked card is the tab stop.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const radios = useRef<(HTMLDivElement | null)[]>([]);
  const sorted = sortForDisplay(props.models);
  const shown = visibleModels(sorted, props.selectedId, expanded);
  const checkedIndex = shown.findIndex((m) => m.id === props.selectedId);
  const anchor = checkedIndex >= 0 ? checkedIndex : 0;
  const tabStop = focusIndex !== null && focusIndex < shown.length ? focusIndex : anchor;
  const rtl = (props.dir ?? i18n?.dir?.() ?? "ltr") === "rtl";
  // The "estimate" caption only appears while a visible meter is size-derived.
  const anyEstimated = shown.some((m) => estimateTiers(m).estimated);

  // Arrows, Home and End move focus between cards, from the radio or from the
  // card's own action button. They never select: choosing a model changes a
  // route, so it takes Enter, Space or a click on a downloaded card.
  const move = (event: KeyboardEvent, from: number) => {
    const next = stepGrid(from, event.key, { columns: COLUMNS, count: shown.length, rtl });
    if (next === from) return;
    event.preventDefault();
    setFocusIndex(next);
    radios.current[next]?.focus();
  };

  // Only a downloaded model can be chosen. A download starts from the card's
  // Download button and nowhere else.
  const choose = (m: CartridgeModel) => {
    if (m.isDownloaded && m.id !== props.selectedId) props.onSelect(m.id);
  };

  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        dir={rtl ? "rtl" : "ltr"}
        aria-label={props.label}
        className="grid grid-cols-2 gap-2.5"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocusIndex(null);
        }}
      >
        {shown.map((m, i) => {
          const tiers = estimateTiers(m);
          const fit = fitFor(m.sizeBytes, props.totalMemoryBytes);
          const tooLarge = fit === "tooLarge" && !m.isDownloaded;
          const checked = m.id === props.selectedId;
          const usedBy = props.usedBy?.[m.id] ?? [];
          const nameId = `${baseId}-name-${i}`;
          const factsId = `${baseId}-facts-${i}`;
          const stop = i === tabStop ? 0 : -1;
          const onFocus = () => setFocusIndex(i);
          return (
            <div
              key={m.id}
              data-card={m.id}
              className={cn(
                "relative rounded-[10px] border bg-card p-3 transition-[border-color,translate] duration-[var(--motion-fast)] motion-safe:hover:-translate-y-px dark:hover:translate-y-0",
                checked ? "border-2 border-ring p-[11px]" : "border-border"
              )}
            >
              <div
                role="radio"
                aria-checked={checked}
                aria-disabled={!m.isDownloaded || undefined}
                aria-labelledby={nameId}
                aria-describedby={factsId}
                tabIndex={stop}
                data-model={m.id}
                ref={(el) => {
                  radios.current[i] = el;
                }}
                onFocus={onFocus}
                onClick={() => choose(m)}
                onKeyDown={(event) => {
                  if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    choose(m);
                    return;
                  }
                  move(event, i);
                }}
                className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span id={nameId} className="text-sm font-semibold text-foreground">
                    {m.name}
                  </span>
                  {m.recommended && (
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {t("common.recommended")}
                    </span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-[82px_1fr] items-center gap-x-2 gap-y-1">
                  {tiers.speed !== null && (
                    <Pips label={t("cartridge.speed")} value={tiers.speed} />
                  )}
                  {tiers.quality !== null && (
                    <Pips label={t("cartridge.quality")} value={tiers.quality} />
                  )}
                  {tiers.memory !== null && (
                    <Pips label={t("cartridge.memory")} value={tiers.memory} />
                  )}
                </div>
                <p id={factsId} className="mt-2 text-[11px] text-muted-foreground">
                  {[
                    m.sizeBytes ? formatDecimalBytes(m.sizeBytes) : null,
                    m.contextLength
                      ? t("cartridge.context", { k: Math.round(m.contextLength / 1024) })
                      : null,
                    m.badge ?? null,
                    tooLarge
                      ? t("cartridge.tooLarge", {
                          needs: formatDecimalBytes(estimateRamBytes(m.sizeBytes!)),
                          total: formatDecimalBytes(props.totalMemoryBytes!),
                        })
                      : fit === "tight" && !m.isDownloaded
                        ? t("cartridge.tight")
                        : null,
                    !m.isDownloaded && !m.isDownloading && !tooLarge
                      ? t("cartridge.notDownloaded")
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                {m.isDownloading ? (
                  <div className="flex flex-1 items-center gap-2">
                    <div
                      role="progressbar"
                      aria-valuenow={Math.round(m.progress ?? 0)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t("cartridge.downloading", { name: m.name })}
                      className="h-1.5 flex-1 overflow-hidden rounded-full border border-border bg-muted"
                    >
                      <div
                        className="h-full bg-foreground/70 transition-[inline-size] duration-[var(--motion-base)]"
                        style={{ inlineSize: `${m.progress ?? 0}%` }}
                      />
                    </div>
                    {props.onCancel && (
                      <Button
                        size="sm"
                        variant="outline"
                        tabIndex={stop}
                        data-model-action={m.id}
                        disabled={m.isCancelling || m.isInstalling}
                        onFocus={onFocus}
                        onKeyDown={(event) => move(event, i)}
                        onClick={() => props.onCancel!(m.id)}
                        aria-label={t("cartridge.cancel", { name: m.name })}
                      >
                        <X size={12} aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                ) : m.isDownloaded ? (
                  <>
                    <span className="text-xs font-medium text-locality-device">
                      {t("routes.state.ready")}
                    </span>
                    {props.onDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        tabIndex={stop}
                        data-model-action={m.id}
                        onFocus={onFocus}
                        onKeyDown={(event) => move(event, i)}
                        onClick={() => props.onDelete!(m.id)}
                        aria-label={t("cartridge.delete", { name: m.name })}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant={m.recommended ? "default" : "outline"}
                    tabIndex={stop}
                    data-model-action={m.id}
                    disabled={tooLarge}
                    onFocus={onFocus}
                    onKeyDown={(event) => move(event, i)}
                    onClick={() => props.onDownload(m.id)}
                    aria-label={t("cartridge.downloadNamed", { name: m.name })}
                  >
                    <Download size={12} className="me-1" aria-hidden="true" />
                    {t("cartridge.download")}
                  </Button>
                )}
              </div>
              {m.href && m.hrefLabel && (
                <a
                  href={m.href}
                  tabIndex={stop}
                  onFocus={onFocus}
                  onKeyDown={(event) => move(event, i)}
                  onClick={createExternalLinkHandler(m.href)}
                  className="mt-2 inline-block text-[11px] text-link underline underline-offset-2 hover:text-link-hover"
                >
                  {m.hrefLabel}
                </a>
              )}
              {usedBy.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground">{t("cartridge.inUseBy")}</span>
                  {usedBy.map((task) => (
                    <span
                      key={task}
                      className="rounded-full bg-muted px-1.5 py-px font-semibold text-foreground"
                    >
                      {task}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        {anyEstimated ? (
          <p className="text-[11px] text-muted-foreground">{t("cartridge.estimate")}</p>
        ) : (
          <span />
        )}
        {sorted.length > 5 && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? t("cartridge.showFewer") : t("cartridge.showAll", { count: sorted.length })}
          </Button>
        )}
      </div>
    </div>
  );
}
