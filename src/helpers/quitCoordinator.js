// One coordinated shutdown. The first quit runs flush → teardown → shutdown → exit.
// Every later quit event is prevented until that exit, so Electron's default quit can
// never bypass a flush that is still saving (R1-I9).
function createQuitCoordinator({ isUpdateExit = () => false, flush, teardown, shutdown, exit }) {
  let shuttingDown = false;
  return function onBeforeQuit(event) {
    if (!shuttingDown && isUpdateExit()) return; // the updater already tore down and is restarting
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    Promise.resolve()
      .then(() => flush?.())
      .catch(() => {})
      .then(() => teardown())
      .catch(() => {})
      .then(() => shutdown())
      .catch(() => {})
      .finally(() => exit(0));
  };
}

module.exports = { createQuitCoordinator };
