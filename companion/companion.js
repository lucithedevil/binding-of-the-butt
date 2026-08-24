// ========== FILE: companion.js ==========
const fs   = require("fs");
const net  = require("net");
const { WebSocket } = require("ws");
const { ButtplugClient,
        ButtplugNodeWebsocketClientConnector } = require("buttplug");

const GAME_PORT = 58711;
const BPC_URL = "ws://127.0.0.1:12345";
const CONFIG_FN = "config.json";

let fatalExitInProgress = false;

function handleFatalError(error) {
  if (fatalExitInProgress) return;
  fatalExitInProgress = true;

  const code = error && error.code;
  const message = (error && error.message) ? error.message : String(error);

  if (code === "ECONNREFUSED") {
    console.error("❌  Intiface connection refused at ws://127.0.0.1:12345");
  } else {
    console.error("❌  Fatal companion error:", message);
  }

  console.error("💡  Check that:");
  console.error("   - Intiface Central is running");
  console.error("   - The server listens on ws://127.0.0.1:12345");
  console.error("   - No firewall is blocking the connection");

  process.exit(1);
}

process.on("uncaughtException", handleFatalError);
process.on("unhandledRejection", handleFatalError);

let CONF = {};
let EVENT_BOOSTS = {};
let INTENSITY_BASE = 0.05;
let EVENT_DECAY_SECONDS = 5;
let PLAYER_HURT_MUTE_SECONDS = 5;
let PLAYER_HURT_REENTRY_JOLT = 0.2;

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FN, "utf8")
                  .split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
    CONF = JSON.parse(raw);
    EVENT_BOOSTS = CONF.EVENT_BOOSTS || {};
    INTENSITY_BASE = CONF.INTENSITY_BASE ?? 0.05;
    EVENT_DECAY_SECONDS = Math.max(1, Number(CONF.EVENT_DECAY_SECONDS ?? 5));
    PLAYER_HURT_MUTE_SECONDS = Math.max(
      0,
      Number(EVENT_BOOSTS.PLAYER_HURT ?? CONF.PLAYER_HURT_MUTE_SECONDS ?? 5)
    );
    PLAYER_HURT_REENTRY_JOLT = Math.max(
      0,
      Number(CONF.PLAYER_HURT_REENTRY_JOLT ?? 0.2)
    );
    console.log("🔄  Config reloaded:", CONFIG_FN);
  } catch (e) {
    console.error("⚠️  Config read error:", e.message);
  }
}
loadConfig();
fs.watchFile(CONFIG_FN, { interval: 1000 }, loadConfig);

let currentIntensity = INTENSITY_BASE;
let targetIntensity = INTENSITY_BASE;
let loops = {};
let modConnected = false;
let socketConnected = false;
let gameBaseIntensity = 0; // Base intensity for the current run
let muteUntil = 0;
let muteActive = false;

let activeBoosts = [];
let nextBoostId = 1;

function addTimedBoost(type, amount) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return;

  const steps = Math.max(1, Math.round(EVENT_DECAY_SECONDS));
  activeBoosts.push({
    id: nextBoostId++,
    type,
    current: numericAmount,
    stepDownPerSecond: numericAmount / steps,
    nextStepAt: Date.now() + 1000
  });
}

function updateTimedBoosts(nowMs) {
  for (const b of activeBoosts) {
    while (nowMs >= b.nextStepAt && b.current > 0) {
      b.current = Math.max(0, b.current - b.stepDownPerSecond);
      b.nextStepAt += 1000;
    }
  }

  activeBoosts = activeBoosts.filter(b => b.current > 0);
}

function getTimedBoostTotal() {
  let total = 0;
  for (const b of activeBoosts) total += b.current;
  return total;
}

function resetTransientState() {
  muteUntil = 0;
  muteActive = false;
  activeBoosts = [];
}

function probeServerName(wsUrl, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    let timeout;

    const finish = (name) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.close(); } catch (_) { }
      }
      resolve(name || null);
    };

    try {
      socket = new WebSocket(wsUrl);
    } catch (_) {
      finish(null);
      return;
    }

    timeout = setTimeout(() => finish(null), timeoutMs);

    socket.on("open", () => {
      const request = [
        {
          RequestServerInfo: {
            Id: 1,
            ClientName: "BindingOfTheButt-Probe",
            MessageVersion: 3
          }
        }
      ];
      try {
        socket.send(JSON.stringify(request));
      } catch (_) {
        finish(null);
      }
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString());
        if (!Array.isArray(payload)) {
          finish(null);
          return;
        }

        for (const msg of payload) {
          if (msg && msg.ServerInfo && typeof msg.ServerInfo.ServerName === "string") {
            finish(msg.ServerInfo.ServerName);
            return;
          }
        }
      } catch (_) {
        finish(null);
      }
    });

    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));
  });
}

function formatDeviceLabel(device) {
  const rawName = device && device.name ? device.name : "Unknown Device";
  const displayName = device && device.displayName ? device.displayName : undefined;
  return displayName || rawName;
}

function logDetectedDevice(device) {
  console.log("➕ New toy detected:", formatDeviceLabel(device));
  console.log("   Available features:", device.vibrateAttributes ? device.vibrateAttributes.length : "Undefined");
}

function logStartupDetectedDevice(device) {
  console.log("    Toy detected:", formatDeviceLabel(device));
  console.log("        Available features:", device.vibrateAttributes ? device.vibrateAttributes.length : "Undefined");
}

let globalDevices = [];

setInterval(() => {
  if (!modConnected) return;

  const now = Date.now();
  const isMutedNow = now < muteUntil;

  if (muteActive && !isMutedNow && PLAYER_HURT_REENTRY_JOLT > 0) {
    addTimedBoost("PLAYER_HURT_REENTRY", PLAYER_HURT_REENTRY_JOLT);
    console.log(`💥  PLAYER_HURT mute ended -> reentry jolt +${Math.round(PLAYER_HURT_REENTRY_JOLT * 100)}%`);
  }

  muteActive = isMutedNow;
  updateTimedBoosts(now);

  const baseLevel = gameBaseIntensity > 0 ? gameBaseIntensity : INTENSITY_BASE;
  const timedBoost = getTimedBoostTotal();
  targetIntensity = Math.min(1.0, Math.max(0, baseLevel + timedBoost));
  currentIntensity = isMutedNow ? 0 : targetIntensity;

  for (const d of globalDevices) {
    try {
      if (d.vibrateAttributes && d.vibrateAttributes.length > 0) {
        d.vibrate(currentIntensity);
      }
    } catch (error) {
      console.error("⚠️  Vibration error:", error.message);
    }
  }
}, 100);

(async () => {
  try {
    const bp = new ButtplugClient("BindingOfTheButt");
    console.log("🔌  Attempting to connect to Intiface at", BPC_URL);
    const probedServerName = await probeServerName(BPC_URL);
    await bp.connect(new ButtplugNodeWebsocketClientConnector(BPC_URL));
    console.log("✅  Connected to server:", probedServerName || "(unnamed server)");
    await bp.startScanning();
    console.log("🔍  Device scan started");
    globalDevices = bp.devices;
    console.log("📱  Devices detected:", globalDevices.length);

    // Startup listing for devices that were already connected before companion launch.
    for (const device of globalDevices) {
      logStartupDetectedDevice(device);
    }

  bp.on("deviceadded", device => {
    logDetectedDevice(device);
    globalDevices = bp.devices;
    console.log("📱  Total devices:", globalDevices.length);
  });

  bp.on("deviceremoved", device => {
    console.log("➖ Toy removed:", formatDeviceLabel(device));
    globalDevices = bp.devices;
    console.log("📱  Total devices:", globalDevices.length);
  });

  const server = net.createServer(socket => {
    console.log("🕹️  BoI mod connected");
    socketConnected = true;

    socket.on("data", async chunk => {
      const lines = chunk.toString().trim().split("\n");
      for (const line of lines) {
        let ev; try { ev = JSON.parse(line); } catch { continue; }

        if (ev.type === "HELLO") {
          modConnected = true;
          resetTransientState();
          targetIntensity = 0;
          currentIntensity = 0;
          console.log("🤝  Mod connected - waiting for game start");
          continue;
        }

        handleEvent(ev);
      }
    });

    socket.on("close", () => {
      console.log("🚪  Mod disconnected (reset or menu return)");
      modConnected = false;
      socketConnected = false;
      gameBaseIntensity = 0;
      resetTransientState();
      targetIntensity = INTENSITY_BASE;
      currentIntensity = INTENSITY_BASE;
      for (const key in loops) {
        clearInterval(loops[key]);
        loops[key] = null;
      }
      globalDevices.forEach(d => d.stop());
    });
  });

  server.listen(GAME_PORT, "127.0.0.1",
    () => console.log("⌛  Waiting for Binding of Isaac on", GAME_PORT));

  } catch (error) {
    handleFatalError(error);
  }
})();

function handleEvent(ev) {
  // 🔁 RESET -> stop everything and switch offline
  if (ev.type === "RESET") {
    console.log("🔁  RESET received -> full reset");
    modConnected = false;                  // stop base loop
    resetTransientState();
    targetIntensity = INTENSITY_BASE;
    currentIntensity = INTENSITY_BASE;
    // stop all loops such as HEART_LOW, etc.
    for (const key in loops) {
      clearInterval(loops[key]);
      loops[key] = null;
    }
    // stop vibrations
    globalDevices.forEach(d => d.stop());
    return;
  }

  if (ev.type === "HEART_LOW") {
    const cfg = CONF["HEART_LOW"];
    if (!cfg) return;
    if (ev.state === "start") {
      if (loops.HEART_LOW) return;
      console.log("❤️  DANGER loop started");
      loops.HEART_LOW = setInterval(async () => {
        if (Date.now() < muteUntil) {
          return;
        }

        for (const d of globalDevices) {
          try {
            if (d.vibrateAttributes && d.vibrateAttributes.length > 0) {
              await d.vibrate(cfg.intensity);
            }
          } catch (error) {
            console.error("⚠️  HEART_LOW vibration error:", error.message);
          }
        }
        setTimeout(() => {
          globalDevices.forEach(d => {
            try {
              d.stop();
            } catch (error) {
              console.error("⚠️  Vibration stop error:", error.message);
            }
          });
        }, cfg.duration * 1000);
      }, cfg.interval * 1000);
    } else if (ev.state === "stop") {
      console.log("💤  DANGER loop stopped");
      clearInterval(loops.HEART_LOW);
      loops.HEART_LOW = null;
      globalDevices.forEach(d => d.stop());
    }
    return;
  }

  if (ev.type === "PLAYER_HURT") {
    const muteMs = Math.round(Math.max(0, PLAYER_HURT_MUTE_SECONDS) * 1000);
    muteUntil = Math.max(muteUntil, Date.now() + muteMs);
    console.log(`🛑  PLAYER_HURT -> muted for ${PLAYER_HURT_MUTE_SECONDS}s`);
    return;
  }

  // Special handling for GAME_START to enable base vibration
  if (ev.type === "GAME_START") {
    const baseIntensity = EVENT_BOOSTS["GAME_START"];
    if (typeof baseIntensity === "number") {
      gameBaseIntensity = baseIntensity;
      targetIntensity = baseIntensity;
      currentIntensity = baseIntensity;
      console.log(`🎮  Game started -> base vibration enabled (${Math.round(baseIntensity * 100)}%)`);
    }
    return;
  }

  const boost = EVENT_BOOSTS[ev.type];
  if (typeof boost === "number") {
    addTimedBoost(ev.type, boost);
    console.log(`⚡  ${ev.type} boost -> +${Math.round(boost * 100)}% (decays over ${EVENT_DECAY_SECONDS}s)`);
  } else {
    console.log(`ℹ️  ${ev.type} ignored (no boost defined)`);
  }
}
