import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LiveKeycap } from "./LiveKeycap";

export const TOUR_ADVANCE_MS = 4000;
const SLIDES = ["shortcut", "privacy", "demo"] as const;

// eslint-disable-next-line react-refresh/only-export-components -- Task14 publishes this pure predicate beside its carousel.
export function shouldAutoAdvance({
  reducedMotion,
  paused,
  skipped,
}: {
  reducedMotion: boolean;
  paused: boolean;
  skipped: boolean;
}): boolean {
  return !reducedMotion && !paused && !skipped;
}

export function MeetLoquiTour({
  hotkeyLabel,
  activationMode,
  platform,
  reducedMotion,
}: {
  hotkeyLabel: string;
  activationMode: "tap" | "push";
  platform: "darwin" | "linux" | "win32";
  reducedMotion: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.visibilityState === "hidden");
  const [skipped, setSkipped] = useState(false);
  const paused = hovered || focused || hidden;
  const advancing = shouldAutoAdvance({ reducedMotion, paused, skipped });

  useEffect(() => {
    const update = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!advancing) return;
    const id = setInterval(
      () => setIndex((current) => (current + 1) % SLIDES.length),
      TOUR_ADVANCE_MS
    );
    return () => clearInterval(id);
  }, [advancing]);

  if (skipped) return <p className="onb-muted">{t("setupFlow.tour.skipped")}</p>;

  const device = platform === "darwin" ? "Mac" : "Other";
  const bodies = {
    shortcut: t(`setupFlow.tour.shortcut.${activationMode}`, { key: hotkeyLabel }),
    privacy: t(`setupFlow.tour.privacy.body${device}`),
    demo: t("setupFlow.tour.demo.body"),
  };
  const go = (next: number) => setIndex((next + SLIDES.length) % SLIDES.length);

  return (
    <section
      className="onb-tour"
      aria-roledescription={t("setupFlow.tour.carouselRole")}
      aria-label={t("setupFlow.tour.label")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const forward = event.key === (i18n.dir() === "rtl" ? "ArrowLeft" : "ArrowRight");
        go(index + (forward ? 1 : -1));
      }}
    >
      <div className="onb-tour__head">
        <h2 className="onb-card__title">{t("setupFlow.tour.title")}</h2>
        <button type="button" className="onb-footer__skip" onClick={() => setSkipped(true)}>
          {t("setupFlow.tour.skip")}
        </button>
      </div>
      <div className="onb-tour__slides">
        {SLIDES.map((slide, slideIndex) => (
          <div
            key={slide}
            className="onb-tour__slide"
            aria-roledescription={t("setupFlow.tour.slideRole")}
            aria-label={t("setupFlow.tour.slideOf", {
              current: slideIndex + 1,
              total: SLIDES.length,
            })}
            aria-hidden={slideIndex !== index}
            hidden={slideIndex !== index}
            data-active={slideIndex === index || undefined}
          >
            <div className="onb-tour__art">
              {slide === "shortcut" ? (
                <LiveKeycap
                  label={hotkeyLabel}
                  sublabel=""
                  pressed={false}
                  size={56}
                  demo={slideIndex === index && advancing}
                />
              ) : slide === "privacy" ? (
                <ol className="onb-map">
                  {(["mic", "loqui", "model", "notes"] as const).map((node) => (
                    <li key={node}>{t(`setupFlow.tour.privacy.nodes.${node}`)}</li>
                  ))}
                </ol>
              ) : (
                <p
                  className="onb-demo"
                  data-active={(slideIndex === index && advancing) || undefined}
                  data-reduced={reducedMotion || undefined}
                >
                  <span className="onb-demo__raw">{t("setupFlow.tour.demo.raw")}</span>
                  <span className="onb-demo__final">{t("setupFlow.tour.demo.final")}</span>
                </p>
              )}
            </div>
            <div>
              <h3 className="onb-tour__title">{t(`setupFlow.tour.${slide}.title`)}</h3>
              <p className="onb-muted">{bodies[slide]}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="onb-tour__nav">
        <button
          type="button"
          className="onb-tour__arrow"
          aria-label={t("setupFlow.tour.previous")}
          onClick={() => go(index - 1)}
        >
          ‹
        </button>
        {SLIDES.map((slide, slideIndex) => (
          <button
            key={slide}
            type="button"
            className="onb-tour__dot"
            aria-label={t("setupFlow.tour.tip", { number: slideIndex + 1 })}
            aria-current={slideIndex === index ? "true" : undefined}
            onClick={() => go(slideIndex)}
          />
        ))}
        <button
          type="button"
          className="onb-tour__arrow"
          aria-label={t("setupFlow.tour.next")}
          onClick={() => go(index + 1)}
        >
          ›
        </button>
      </div>
    </section>
  );
}
