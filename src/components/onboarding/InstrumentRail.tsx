import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { levelBarScale } from "../ui/levelBarsMath";
import { LevelBars } from "../ui/LevelBars";
import {
  INSTRUMENT_HEIGHT,
  SETTLE_MS,
  barHeights,
  instrumentCaption,
  instrumentFills,
  type InstrumentMode,
} from "./instrumentMath";

export interface InstrumentRailProps {
  title: string;
  body: string;
  mode: InstrumentMode;
  readLevel?: () => number;
}

// The speech bubble around the five bars. No SVG master exists for the mark,
// so this outline is redrawn to its proportions (flag in the brand review).
const BUBBLE_PATH =
  "M10 6 H150 A10 10 0 0 1 160 16 V124 A10 10 0 0 1 150 134 H70 L48 154 V134 H10 A10 10 0 0 1 0 124 V16 A10 10 0 0 1 10 6 Z";

// The light rail is the solid --color-live surface; Plum Night's is a tinted surface.
function useDarkTheme(): boolean {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const [dark, setDark] = useState(() => root?.classList?.contains("dark") ?? false);
  useEffect(() => {
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [root]);
  return dark;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
  useEffect(() => {
    const query = globalThis.window?.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const change = () => setReduced(query.matches);
    change();
    query.addEventListener?.("change", change);
    return () => query.removeEventListener?.("change", change);
  }, []);
  return reduced;
}

export function InstrumentRail({ title, body, mode, readLevel }: InstrumentRailProps) {
  const { t, i18n } = useTranslation();
  const dark = useDarkTheme();
  const reduced = useReducedMotion();
  // M2 (R3-M01): one LevelBars instance lives from the first "listening" of a take
  // through "processing" and the settle after "success", so its frame is never
  // reset. The meter state is adjusted during render when the mode changes (React's
  // documented "adjust state on prop change" pattern), so no render ever drops it.
  //   live     → the real level;
  //   settling → zero input: the driver's own smoothing eases the bars to the rest
  //              silhouette, the mark's proportions (processing, then SETTLE_MS of success);
  //   off      → the static bars; on success, the mark and its bubble (DRAW_MS), then the dock.
  const [meter, setMeter] = useState<"off" | "live" | "settling">(
    mode.kind === "listening" ? "live" : "off"
  );
  const [prevKind, setPrevKind] = useState(mode.kind);
  const [prevReduced, setPrevReduced] = useState(reduced);
  if (mode.kind !== prevKind || reduced !== prevReduced) {
    setPrevReduced(reduced);
    setPrevKind(mode.kind);
    if (mode.kind === "listening") setMeter("live");
    else if ((mode.kind === "processing" || mode.kind === "success") && meter !== "off" && !reduced)
      setMeter("settling");
    else setMeter("off"); // another mode, nothing live to settle, or an instant swap under reduced motion
  }
  useEffect(() => {
    if (mode.kind !== "success" || meter !== "settling") return;
    const id = setTimeout(() => setMeter("off"), SETTLE_MS);
    return () => clearTimeout(id);
  }, [meter, mode.kind]);
  const silence = useCallback(() => 0, []);
  const liveLevel =
    meter === "live" ? (readLevel ?? silence) : meter === "settling" ? silence : undefined;
  const stage = mode.kind !== "success" ? "live" : meter === "settling" ? "settle" : "mark";
  const caption = instrumentCaption(mode, i18n?.language);
  const fills = instrumentFills(mode);
  const captionText =
    caption.key === "downloading"
      ? t("setupFlow.instrument.downloading", {
          percent: caption.percent,
          done: t(`setupFlow.units.${caption.done.unit}`, { value: caption.done.value }),
          total: t(`setupFlow.units.${caption.total.unit}`, { value: caption.total.value }),
        })
      : t(`setupFlow.instrument.${caption.key}`);
  return (
    <section className="onb-rail" data-mode={mode.kind}>
      <div className="onb-rail__copy">
        <h1 tabIndex={-1}>{title}</h1>
        {body ? <p>{body}</p> : null}
      </div>
      <div
        className="onb-instrument"
        data-mode={mode.kind}
        data-stage={stage}
        data-meter={meter}
        aria-hidden="true"
      >
        {mode.kind === "success" && stage === "mark" ? (
          <svg
            className="onb-bubble"
            data-bubble=""
            viewBox="-4 0 168 160"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={BUBBLE_PATH} pathLength={1} />
          </svg>
        ) : null}
        {liveLevel ? (
          // One keyed instance: changing readLevel never remounts it (LevelBars keeps the latest in a ref).
          <LevelBars
            key="take-meter"
            readLevel={liveLevel}
            height={INSTRUMENT_HEIGHT}
            tone={dark ? "brand" : "onLive"}
          />
        ) : (
          <span className="onb-static-bars">
            {barHeights().map((height, index) => (
              <span
                key={index}
                className="onb-bar"
                style={{
                  height:
                    mode.kind === "success"
                      ? INSTRUMENT_HEIGHT * levelBarScale(index, 0, 0.5)
                      : height,
                }}
              >
                <span
                  className="onb-bar__fill"
                  style={{ "--fill": fills[index] } as CSSProperties}
                />
              </span>
            ))}
          </span>
        )}
      </div>
      <p className="onb-instrument__caption">{captionText}</p>
    </section>
  );
}
