import { useCallback, useState } from "react";
import CaptureMenu, {
  LAST_CAPTURE_ACTION_KEY,
  readLastCaptureAction,
  type CaptureAction,
} from "./CaptureMenu";
import { useLiveClock, type CaptureStatusModel } from "../hooks/useCaptureStatus";
import { useWorkspaceNavigation } from "./workspaceNavigation";
import { getCachedPlatform } from "../utils/platform";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";

export default function CaptureControl({
  capture,
  hotkey,
  showChat,
}: {
  capture: CaptureStatusModel;
  hotkey: string;
  showChat: boolean;
}) {
  const navigation = useWorkspaceNavigation();
  const [lastAction, setLastAction] = useState<CaptureAction>(() => {
    try {
      return readLastCaptureAction(window.localStorage);
    } catch {
      return "dictate";
    }
  });
  const now = useLiveClock(capture.kind === "listening");

  const run = useCallback(
    (action: CaptureAction) => {
      setLastAction(action);
      try {
        window.localStorage.setItem(LAST_CAPTURE_ACTION_KEY, action);
      } catch {
        // not persisted; harmless
      }
      if (action === "dictate") void capture.toggleDictation();
      else if (action === "recordMeeting") navigation.recordMeeting();
      else if (action === "upload") navigation.openUpload();
      else if (action === "newNote") navigation.newNote();
      else navigation.startChat();
    },
    [capture, navigation]
  );

  return (
    <CaptureMenu
      status={capture}
      now={now}
      readLevel={capture.readLevel}
      lastAction={lastAction}
      hotkeyLabel={formatHotkeyLabel(parseHotkeyList(hotkey)[0])}
      platform={getCachedPlatform()}
      showChat={showChat}
      onRun={run}
      onStop={() => void capture.stop()}
    />
  );
}
