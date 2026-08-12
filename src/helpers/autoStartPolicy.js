// Launch-at-login decisions, kept free of Electron so they can be unit-tested.
//
// Windows has no equivalent of macOS' openAsHidden (which is itself a no-op on
// macOS 13 and up), so a login item that should come up in the tray has to say so
// with a command-line flag we read back at startup. Linux rides the same flag on
// the autostart entry's Exec line; macOS reports it through wasOpenedAtLogin.

const HIDDEN_LAUNCH_FLAG = "--hidden";

// The args a Windows login item is registered with. getLoginItemSettings compares
// the registry value against `"exe" args` verbatim, so reads have to pass exactly
// what writes did or openAtLogin always reports false.
function getLoginItemArgs(platform) {
  return platform === "win32" ? [HIDDEN_LAUNCH_FLAG] : [];
}

// On Windows, openAtLogin only reports whether the Run entry matches this
// executable and args. It ignores Explorer's StartupApproved key, which is what
// Task Manager and Settings write when a user disables a startup app, so an app
// the user switched off still reads as enabled. executableWillLaunchAtLogin is
// the only field that accounts for both.
function resolveAutoStartState({ platform, loginItemSettings }) {
  if (platform === "win32") {
    return {
      enabled: !!loginItemSettings.executableWillLaunchAtLogin,
      requiresApproval: false,
    };
  }
  return {
    enabled: !!loginItemSettings.openAtLogin,
    // macOS 13+ routes login items through SMAppService, which can register an
    // item and still leave it awaiting the user's approval in System Settings.
    // Without surfacing that, the toggle just appears not to stick.
    requiresApproval: loginItemSettings.status === "requires-approval",
  };
}

// A login item written before this build carries no --hidden, so it no longer
// matches what we now write and openAtLogin reads false while the stale entry
// keeps launching the app with its window showing. Rewriting it uses the same
// registry value name, so it re-points the entry instead of adding a second one.
function needsHiddenFlagMigration({ platform, loginItemSettings }) {
  if (platform !== "win32") return false;
  return !!loginItemSettings.executableWillLaunchAtLogin && !loginItemSettings.openAtLogin;
}

// Whether this process was started by the login item rather than by the user, in
// which case it should go straight to the tray. Checked instead of the user's
// startMinimized preference so a login launch never overwrites it.
function wasLaunchedHidden({ platform, argv, loginItemSettings }) {
  if (platform === "darwin") return !!loginItemSettings?.wasOpenedAtLogin;
  return !!argv?.includes(HIDDEN_LAUNCH_FLAG);
}

module.exports = {
  HIDDEN_LAUNCH_FLAG,
  getLoginItemArgs,
  resolveAutoStartState,
  needsHiddenFlagMigration,
  wasLaunchedHidden,
};
