import type { StartRecordingArgs } from "../stores/meetingRecordingStore";

interface MeetingRecordingRequestOptions {
  args: StartRecordingArgs;
  startRecording: (args: StartRecordingArgs) => Promise<boolean>;
  restoreFromMeetingMode: () => Promise<void> | void;
  onHandled: () => void;
}

export async function handleMeetingRecordingRequest({
  args,
  startRecording,
  restoreFromMeetingMode,
  onHandled,
}: MeetingRecordingRequestOptions): Promise<void> {
  const accepted = await startRecording(args);
  if (!accepted) await restoreFromMeetingMode();
  onHandled();
}
