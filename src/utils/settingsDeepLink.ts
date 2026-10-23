// Plan 03's settingsPath grammar: "<section>" or "<section>/<subTab>",
// letters only. Anything else opens Settings at its default section.
const SETTINGS_PATH = /^[A-Za-z]+(?:\/[A-Za-z]+)?$/;

export interface SettingsLink {
  id: string;
  path: string | null;
}

interface SettingsLinkApi {
  onShowSettings?: (callback: (link?: SettingsLink) => void) => () => void;
  pendingSettingsLink?: () => Promise<SettingsLink | null>;
  ackSettingsLink?: (id: string) => Promise<boolean>;
}

export function parseSettingsDeepLink(payload: unknown): string | undefined {
  const value = (payload as { path?: unknown } | null)?.path;
  return typeof value === "string" && SETTINGS_PATH.test(value) ? value : undefined;
}

/**
 * The control panel's Settings deep-link subscriber (I12). Main holds each
 * request until this acknowledges it. A request sent while the panel was
 * loading or reloading is fetched here on mount, so it is never lost into a
 * page that had no listener yet. The push and the mount check can carry the
 * same request; it opens once. A request opens only after main confirms it
 * is still the current one, so an expired or replaced request never opens.
 */
export function subscribeSettingsDeepLinks(
  api: SettingsLinkApi | undefined,
  open: (section: string | undefined, activationId: string) => void
): () => void {
  const ack = api?.ackSettingsLink;
  if (!api?.onShowSettings || !ack) return () => {};
  let disposed = false;
  const seen = new Set<string>();
  let sequence = 0;
  let confirmed = 0;
  const apply = (link: SettingsLink | null | undefined) => {
    if (disposed || !link?.id || seen.has(link.id)) return;
    seen.add(link.id);
    const attempt = ++sequence;
    // Main answers true only for its current request. A push that was in
    // transit when the request expired or was replaced gets false.
    void Promise.resolve()
      .then(() => (disposed ? false : ack(link.id)))
      .then(
        (current) => {
          if (current && !disposed && attempt > confirmed) {
            confirmed = attempt;
            open(parseSettingsDeepLink(link), link.id);
          }
        },
        () => {}
      );
  };
  const unsubscribe = api.onShowSettings(apply);
  void api.pendingSettingsLink?.().then(
    (link) => {
      if (link) apply(link);
    },
    () => {}
  );
  return () => {
    disposed = true;
    unsubscribe?.();
  };
}
