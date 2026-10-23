// The landing cue for a searched setting (SET-R2 A). The CSS animation is timed by --motion-flash;
// this module only sets data-flash and removes it when that animation ends.
export const FLASH_ANIMATION = "settings-flash";

const owners = new WeakMap<HTMLElement, () => void>();

export function flashSetting(el: HTMLElement): () => void {
  owners.get(el)?.();
  const clear = () => {
    el.removeEventListener("animationend", onEnd);
    if (owners.get(el) !== clear) return;
    owners.delete(el);
    delete el.dataset.flash;
  };
  const onEnd = (e: AnimationEvent) => {
    // A descendant's animation also bubbles an animationend; only our own ends the flash.
    if (e.target === el && e.animationName === FLASH_ANIMATION) clear();
  };
  owners.set(el, clear);
  // Flush the absent marker even after cancellation: removal and reissue can otherwise
  // be batched into one style update and continue the old animation on the same row.
  delete el.dataset.flash;
  void el.offsetWidth;
  el.dataset.flash = "true";
  el.addEventListener("animationend", onEnd);
  // If the stylesheet did not start an animation, no animationend will ever arrive.
  if (
    typeof el.getAnimations === "function" &&
    !el
      .getAnimations()
      .some(
        (animation) => "animationName" in animation && animation.animationName === FLASH_ANIMATION
      )
  )
    clear();
  return clear;
}

type AnchorRoot = Pick<ParentNode, "querySelector">;

export function findSettingAnchor(root: AnchorRoot, anchorId: string): HTMLElement | null {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(anchorId)
      : anchorId.replace(/["\\]/g, "\\$&");
  return root.querySelector<HTMLElement>(`[data-setting-id="${escaped}"]`);
}

export interface LandOptions {
  raf: (cb: () => void) => number;
  caf: (handle: number) => void;
  root?: AnchorRoot;
  /** Frames to wait for the anchor to mount after a section or sub-tab change. */
  maxFrames?: number;
  /** Only the gated screen-context result supplies its assistant prerequisite. */
  fallbackAnchorId?: string;
  onDone?: (landed: boolean) => void;
}

/** Scroll to the anchor and flash it once, waiting for it to mount. Returns a cancel function. */
export function landOnSetting(anchorId: string, options: LandOptions): () => void {
  const { raf, caf, maxFrames = 24, onDone } = options;
  const root = options.root ?? document;
  let frame = 0;
  let handle = 0;
  let cancelled = false;
  let clearFlash: (() => void) | undefined;
  const visible = (el: HTMLElement | null): el is HTMLElement =>
    !!el && (typeof el.getClientRects !== "function" || el.getClientRects().length > 0);
  const finish = (el: HTMLElement) => {
    el.scrollIntoView({ block: "center" });
    clearFlash = flashSetting(el);
    onDone?.(true);
  };
  const tick = () => {
    if (cancelled) return;
    const el = findSettingAnchor(root, anchorId);
    if (visible(el)) {
      finish(el);
      return;
    }
    frame += 1;
    if (frame >= maxFrames) {
      const fallback = options.fallbackAnchorId
        ? findSettingAnchor(root, options.fallbackAnchorId)
        : null;
      if (visible(fallback)) finish(fallback);
      else onDone?.(false);
      return;
    }
    handle = raf(tick);
  };
  handle = raf(tick);
  return () => {
    cancelled = true;
    caf(handle);
    clearFlash?.();
  };
}
