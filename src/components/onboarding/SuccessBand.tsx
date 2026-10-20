import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";

/** Closes Phase 1 (ONB-R2 B): the first words were yours, then a choice. */
export function SuccessBand({
  onPersonalize,
  onFinish,
}: {
  onPersonalize(): void;
  onFinish(): void;
}) {
  const { t } = useTranslation();
  return (
    <section className="onb-band" aria-labelledby="onb-band-title">
      <p id="onb-band-title" className="onb-band__title">
        {t("setupFlow.try.bandTitle")}
      </p>
      <div className="onb-band__actions">
        <Button onClick={onPersonalize}>{t("setupFlow.try.makeItYours")}</Button>
        <Button variant="ghost" onClick={onFinish}>
          {t("setupFlow.try.startUsing")}
        </Button>
      </div>
    </section>
  );
}
