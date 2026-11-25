const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { dialog } = require("electron");
const { getLinuxSessionInfo } = require("./linuxSession");

function getLogger() {
  return require("./debugLogger");
}

const execFileAsync = promisify(execFile);

// Probes run off the main thread's event loop: a slow systemctl/pgrep must not
// freeze startup or the settings window. A non-zero exit still carries stdout
// (systemctl is-active prints "inactive" and exits 3).
async function run(command, args, timeout = 5000) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout, windowsHide: true });
    return { ok: true, stdout: String(stdout ?? "") };
  } catch (error) {
    return { ok: false, stdout: String(error?.stdout ?? "") };
  }
}

async function commandExists(name) {
  return (await run("which", [name])).ok;
}

async function isYdotooldRunning() {
  const [ydotoold, ydotool, pgrep] = await Promise.all([
    run("systemctl", ["--user", "is-active", "ydotoold"]),
    run("systemctl", ["--user", "is-active", "ydotool"]),
    run("pgrep", ["-x", "ydotoold"]),
  ]);
  return ydotoold.stdout.trim() === "active" || ydotool.stdout.trim() === "active" || pgrep.ok;
}

function serviceFileExists() {
  const paths = [
    "/usr/lib/systemd/user/ydotoold.service",
    "/usr/lib/systemd/user/ydotool.service",
    `${os.homedir()}/.config/systemd/user/ydotoold.service`,
  ];
  return paths.some((p) => fs.existsSync(p));
}

function isUinputAccessible() {
  try {
    fs.accessSync("/dev/uinput", fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function udevRuleExists() {
  const ruleDirs = ["/etc/udev/rules.d", "/usr/lib/udev/rules.d", "/lib/udev/rules.d"];
  for (const dir of ruleDirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith(".rules")) continue;
        try {
          const content = fs.readFileSync(`${dir}/${file}`, "utf-8");
          if (content.includes("uinput")) return true;
        } catch {}
      }
    } catch {}
  }
  return false;
}

async function userInInputGroup() {
  return (await run("groups", [])).stdout.includes("input");
}

async function ensureYdotool() {
  if (process.platform !== "linux") return;

  const sessionType = (process.env.XDG_SESSION_TYPE || "").toLowerCase();
  if (sessionType !== "wayland" && !process.env.WAYLAND_DISPLAY) return;

  const log = getLogger();

  const [hasYdotool, hasYdotoold, daemonRunning, hasGroup] = await Promise.all([
    commandExists("ydotool"),
    commandExists("ydotoold"),
    isYdotooldRunning(),
    userInInputGroup(),
  ]);
  const hasService = serviceFileExists();
  const hasUinput = isUinputAccessible();

  log.debug(
    "ydotool check",
    { hasYdotool, hasYdotoold, daemonRunning, hasService, hasUinput, hasGroup },
    "clipboard"
  );

  // Everything is fine
  if (hasYdotool && hasYdotoold && daemonRunning && hasUinput) {
    log.debug("ydotool fully configured", {}, "clipboard");
    return;
  }

  // If the service exists and daemon is just not running, try to start it
  if (hasYdotoold && hasService && !daemonRunning) {
    for (const unit of ["ydotoold", "ydotool"]) {
      await run("systemctl", ["--user", "start", unit], 10000);
      if (await isYdotooldRunning()) {
        log.info(`${unit} daemon started`, {}, "clipboard");
        return;
      }
    }
  }

  // Something is missing — build an informative message
  const missing = [];

  if (!hasYdotool) {
    missing.push("- ydotool is not installed. Install it with your package manager.");
  }
  if (!hasYdotoold) {
    missing.push(
      "- ydotoold (daemon) is not installed. On Ubuntu/Pop!_OS: sudo apt install ydotoold. On Arch: included in the ydotool package."
    );
  }
  if (!hasUinput) {
    missing.push(
      '- /dev/uinput is not accessible. Add a udev rule:\n  echo \'KERNEL=="uinput", GROUP="input", MODE="0660", TAG+="uaccess"\' | sudo tee /etc/udev/rules.d/70-uinput.rules\n  sudo udevadm control --reload-rules && sudo udevadm trigger /dev/uinput'
    );
  }
  if (!hasGroup) {
    missing.push(
      "- Your user is not in the 'input' group. Run: sudo usermod -aG input $USER\n  (requires logout/login to take effect)"
    );
  }
  if (hasYdotoold && !hasService) {
    missing.push(
      "- No systemd service found for ydotoold. Enable it with:\n  systemctl --user enable ydotoold && systemctl --user start ydotoold"
    );
  }
  if (hasYdotoold && hasService && !daemonRunning) {
    missing.push(
      "- ydotoold service exists but is not running. Start it with:\n  systemctl --user start ydotoold"
    );
  }

  if (missing.length > 0) {
    const detail = missing.join("\n\n");
    log.warn("ydotool setup incomplete", { missing: missing.length }, "clipboard");

    dialog.showMessageBox({
      type: "warning",
      title: "Wayland Paste Setup",
      message: "ydotool is not fully configured. Auto-paste on Wayland may not work.",
      detail: `The following issues were detected:\n\n${detail}\n\nAfter fixing, restart OpenWhispr.`,
    });
  }
}

function isNixOS() {
  try {
    if (fs.existsSync("/etc/NIXOS")) return true;
    const osRelease = fs.readFileSync("/etc/os-release", "utf8");
    return /^ID=("?)nixos\1$/m.test(osRelease);
  } catch {
    return false;
  }
}

async function getYdotoolStatus() {
  const [hasYdotool, hasYdotoold, hasWtype, daemonRunning, hasGroup] = await Promise.all([
    commandExists("ydotool"),
    commandExists("ydotoold"),
    commandExists("wtype"),
    isYdotooldRunning(),
    userInInputGroup(),
  ]);
  const hasService = serviceFileExists();
  const hasUinput = isUinputAccessible();
  const hasUdevRule = udevRuleExists();
  const { isWayland, isKde, isWlroots } = getLinuxSessionInfo();

  return {
    isLinux: process.platform === "linux",
    isWayland,
    isKde,
    isWlroots,
    hasYdotool,
    hasYdotoold,
    hasWtype,
    daemonRunning,
    hasService,
    hasUinput,
    hasUdevRule,
    hasGroup,
    isNixOS: isNixOS(),
  };
}

module.exports = { ensureYdotool, getYdotoolStatus, commandExists };
