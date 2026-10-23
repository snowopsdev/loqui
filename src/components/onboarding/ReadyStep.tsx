import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Minus } from "../icons";
import { Button } from "../ui/button";
import { RouteDestinationChip } from "../settings/routing/RouteChips";
import type { OnboardingStep } from "../../utils/onboardingState";
import type { NoteActionState, ReadinessSummary } from "../../utils/onboardingReadiness";
import { PrivacyDefaults, type PrivacyDefaultsProps } from "./PrivacyDefaults";

export interface ReadyStepProps {
  platform: "darwin" | "linux" | "win32";
  summary: ReadinessSummary;
  note: NoteActionState;
  noteProviderLabel: string;
  onResume(step: OnboardingStep): void;
  onDictateNote(): void;
  onOpenSettings(path: string): void;
  onOpenWorkspace(): void;
  privacy: Omit<PrivacyDefaultsProps, "platform">;
}

const ICONS = { ready: Check, configured: Check, pending: CircleAlert, optional: Minus } as const;

export function ReadyStep(props: ReadyStepProps) {
  const { platform, summary, note, noteProviderLabel, onResume, onOpenSettings, privacy } = props;
  const { t } = useTranslation();
  const device = platform === "darwin" ? "Mac" : "Other";
  const title =
    summary.pending > 0
      ? t("setupFlow.ready.titlePending", { count: summary.pending })
      : t(summary.proven ? "setupFlow.ready.titleProven" : "setupFlow.ready.titleConfigured");
  const sub =
    summary.pending > 0
      ? t("setupFlow.ready.subPending")
      : summary.proven
        ? t(summary.allLocal ? `setupFlow.ready.subAllLocal${device}` : "setupFlow.ready.subProven")
        : t("setupFlow.ready.subConfigured");
  const noteReady = note.status === "ready";
  const fixNote = () =>
    note.block === "microphone" ? onResume("welcome") : onOpenSettings(note.settingsPath);

  return (
    <>
      <section className="onb-card" aria-labelledby="onb-ready-title">
        <h2 id="onb-ready-title" className="onb-ready__title">
          {title}
        </h2>
        <p className="onb-muted">{sub}</p>
        <ul className="onb-ready-list">
          {summary.rows.map((row) => {
            const Icon = ICONS[row.status];
            const content = (
              <>
                <span className="onb-ready-row__icon" data-status={row.status}>
                  <Icon aria-hidden="true" />
                </span>
                <span className="onb-ready-row__name">{t(`setupFlow.ready.rows.${row.key}`)}</span>
                <span className="onb-ready-row__status">
                  {t(`setupFlow.ready.details.${row.detail}`, row.values)}
                </span>
              </>
            );
            const fixInSettings = row.settingsPath;
            return (
              <li key={row.key}>
                {row.status === "ready" || row.status === "optional" ? (
                  <div className="onb-ready-row">{content}</div>
                ) : (
                  <button
                    type="button"
                    className="onb-ready-row"
                    data-row={row.key}
                    onClick={() =>
                      fixInSettings ? onOpenSettings(fixInSettings) : onResume(row.step)
                    }
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="onb-ready__note">
          <p className="onb-reco__meta">
            <RouteDestinationChip route={note} />
            {/* An engine main attests can't run while sealed is not "transcribed on this device". */}
            {note.status === "checking" || note.block === "nativeUnavailable" ? null : (
              <span>
                {note.locality === "device"
                  ? t("setupFlow.ready.noteLocal")
                  : t(
                      note.locality === "network"
                        ? "setupFlow.ready.noteNetwork"
                        : "setupFlow.ready.noteSends",
                      { provider: noteProviderLabel }
                    )}
              </span>
            )}
          </p>
          <div className="onb-ready__actions">
            <Button
              variant="live"
              onClick={props.onDictateNote}
              disabled={!noteReady}
              aria-describedby={noteReady ? undefined : "onb-ready-note-reason"}
            >
              {t("setupFlow.ready.dictateNote")}
            </Button>
            <Button variant="ghost" onClick={props.onOpenWorkspace}>
              {t("setupFlow.ready.openWorkspace")}
            </Button>
          </div>
          {noteReady ? null : note.status === "checking" ? (
            <p id="onb-ready-note-reason" className="onb-muted" role="status">
              {t("setupFlow.ready.noteChecking")}
            </p>
          ) : (
            <p id="onb-ready-note-reason" className="onb-muted">
              {t(`setupFlow.ready.noteBlocked.${note.block}`, { provider: noteProviderLabel })}{" "}
              <Button size="sm" variant="link" onClick={fixNote}>
                {t("setupFlow.ready.fixNote")}
              </Button>
            </p>
          )}
        </div>
      </section>
      <PrivacyDefaults platform={platform} {...privacy} />
    </>
  );
}
