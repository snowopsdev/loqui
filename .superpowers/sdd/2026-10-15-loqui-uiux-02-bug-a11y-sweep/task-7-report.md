# Task 7 report: dictation error lifetimes and content preservation

Status: DONE

## Implementation

- Updated `getDictationErrorDuration` to return 6,000, 8,000, or 10,000 ms using the existing short and medium message thresholds.
- Changed `showDictationError` to set `duration: 0` when the card contains a recoverable transcript. Errors without a transcript continue to omit duration so the toast provider selects the duration from the message text.
- Updated duration tests and added force-stop coverage for transcript retention and transcript-free error timing.

## TDD evidence

- RED: `PATH=/home/snowdesk/.local/share/mise/installs/node/24.21.0/bin:$PATH npm test -- test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js`
  - Expected failures confirmed: old results were 3000/4000/5000 instead of 6000/8000/10000, and transcript-bearing toast duration was `undefined` instead of `0`.
- GREEN: `PATH=/home/snowdesk/.local/share/mise/installs/node/24.21.0/bin:$PATH npm test -- test/helpers/toastPresentation.test.js test/helpers/useAudioRecordingForceStop.test.js test/hooks/dictationErrorAutoHide.test.js`
  - 19/19 passed; output pristine.

## Self-review

- `git diff --check` passed.
- Changes are limited to the task's two implementation files and two requested test files. No concerns.

## Files changed

- `src/helpers/toastPresentation.js`
- `src/hooks/useAudioRecording.js`
- `test/helpers/toastPresentation.test.js`
- `test/helpers/useAudioRecordingForceStop.test.js`
