import loquiMark from "../assets/brand/mark.svg";
import UpdateSettings from "./settings/UpdateSettings";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import SettingsPage from "./SettingsPage";
import CodexConnection from "./CodexConnection";
import TitleBar from "./TitleBar";
import { Button } from "./ui/button";
interface Props {
  onComplete: (options?: { openSettings?: boolean }) => void;
}
const stages = ["privacyData", "speechToText", "llms", "hotkeys"] as const;
export default function OnboardingFlow({ onComplete }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <TitleBar />
      <header className="shrink-0 px-4 py-3 sm:px-8 sm:py-5 border-b">
        <h1
          className="font-semibold flex items-center gap-2"
          style={{ fontSize: 20, lineHeight: "28px" }}
        >
          <img src={loquiMark} alt="" className="h-7 w-7" />
          Loqui
        </h1>
        <p className="text-sm text-muted-foreground">{t("personal.onboarding")}</p>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-3 sm:px-8 sm:py-6">
        {stages[step] === "llms" && (
          <section className="mb-6 space-y-3" aria-label={t("personal.subscriptionSetupTitle")}>
            <CodexConnection />
            <p className="text-sm text-muted-foreground">{t("personal.subscriptionSetupHelp")}</p>
          </section>
        )}

        <SettingsPage activeSection={stages[step]} />
        {stages[step] === "hotkeys" && (
          <div className="mt-6">
            <UpdateSettings setup />
          </div>
        )}
      </main>
      <footer className="shrink-0 flex justify-between border-t p-3 sm:p-4">
        <Button variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t("common.back")}
        </Button>
        <Button onClick={() => (step === stages.length - 1 ? onComplete() : setStep(step + 1))}>
          {t(step === stages.length - 1 ? "personal.finishSetup" : "common.continue")}
        </Button>
      </footer>
    </div>
  );
}
