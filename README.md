# Binding of the Butt

Binding of the Butt is a local The Binding of Isaac mod + Node.js companion bridge.

- The Lua mod (`main.lua`) emits gameplay events over local TCP (`127.0.0.1:58711`).
- The companion (`companion/companion.js`) receives those events and drives Buttplug devices through Intiface (`ws://127.0.0.1:12345`).

This README is for the current repository layout (no packaged installer required).

## Requirements

1. The Binding of Isaac: Repentance (Repentance+ enabled for LuaSocket support).
2. [Node.js 14+](https://nodejs.org/en/download/current).
3. Intiface Central or another Buttplug-compatible server listening on `ws://127.0.0.1:12345` ([Intiface Central](https://intiface.com/#intiface-central)).

## Repository Layout

- `main.lua`: game-side mod logic and event sender.
- `metadata.xml`: Isaac mod metadata.
- `companion/companion.js`: local event receiver + vibration controller.
- `companion/config.json`: live-reloaded behavior settings.
- `companion/package.json`: companion scripts and dependencies.

## Installation

### 1. Install the Companion Dependencies

From the repository root:

```bash
cd companion
npm install
```

### 2. Install the Mod into Isaac

Copy this repository into your Isaac mods directory so the folder contains `main.lua` and `metadata.xml` at its top level.
- `C:\Program Files (x86)\Steam\steamapps\common\The Binding of Isaac Rebirth\mods`

Expected final mod folder example:

```text
...\mods\binding-of-the-butt\main.lua
...\mods\binding-of-the-butt\metadata.xml
```

## Steam Launch Option (Mandatory)

`--luadebug` is required for this mod to function.

Without `--luadebug`, the mod cannot establish the TCP companion connection.

Set it in Steam:

1. Open Steam.
2. Right-click The Binding of Isaac: Repentance.
3. Click Properties.
4. Add `--luadebug` under Launch Options.

## Running

### Start Order

1. Start Intiface (server available at `ws://127.0.0.1:12345`).
2. Start the companion:

```bash
cd companion
npm start
```

3. Launch The Binding of Isaac: Repentance.

### What Good Startup Looks Like

Companion terminal should include lines like:

```text
✅  Connected to Intiface - <server name>
⌛  Waiting for Binding of Isaac on 58711
🕹️  BoI mod connected
🤝  Mod connected - waiting for game start
```

## Behavior Model

### Base and Event Intensity

- `GAME_START` sets run base intensity from `EVENT_BOOSTS.GAME_START`.
- Other boost events add temporary intensity contributions.
- Each contribution decays in 1-second step-downs over `EVENT_DECAY_SECONDS`.

### Player Damage Punishment

- `EVENT_BOOSTS.PLAYER_HURT` is a mute duration in seconds.
- During mute, output vibration is forced to 0.
- Background event accumulation continues.
- When mute ends, `PLAYER_HURT_REENTRY_JOLT` is applied as a temporary jolt.

### Low Health Pulse (`HEART_LOW`)

Default profile in this repo:

- Intensity: `0.75` (75%)
- Duration: `1.0` second
- Interval: `8.0` seconds

## Configuration Reference

Edit `companion/config.json`. The companion reloads this file automatically.

Current defaults:

```json
{
  "INTENSITY_BASE": 0.0,
  "EVENT_DECAY_SECONDS": 6,
  "PLAYER_HURT_REENTRY_JOLT": 0.2,
  "EVENT_BOOSTS": {
    "PLAYER_HURT": 5,
    "BOSS_DEATH": 0.4,
    "SPECIAL_ENEMY_DEATH": 0.03,
    "ENEMY_DEATH": 0.03,
    "ITEM_QUALITY": 0.15,
    "GAME_START": 0.07
  },
  "HEART_LOW": {
    "type": "loop",
    "intensity": 0.75,
    "duration": 1.0,
    "interval": 8.0
  }
}
```

Field meanings:

- `INTENSITY_BASE`: global baseline when no run base is active.
- `EVENT_DECAY_SECONDS`: per-event decay window for temporary boosts.
- `PLAYER_HURT_REENTRY_JOLT`: extra temporary boost after mute ends.
- `EVENT_BOOSTS.<EVENT>`: boost amount for most events.
- `EVENT_BOOSTS.PLAYER_HURT`: mute duration in seconds.
- `HEART_LOW.intensity`: pulse strength.
- `HEART_LOW.duration`: pulse length in seconds.
- `HEART_LOW.interval`: seconds between pulses.

## Optional: Build a Windows Binary Companion

If you want a standalone `companion.exe`:

```bash
cd companion
npm run build
```

This uses the `pkg` script defined in `companion/package.json`.

The build artifacts are written to:

```text
out/companion.exe
out/config.json
```

## Troubleshooting

### Mod Does Not Connect to Companion

1. Confirm Steam launch option is exactly `--luadebug`.
2. Confirm the companion is running and shows `Waiting for Binding of Isaac on 58711`.
3. Confirm mod files are in the correct Isaac `mods` folder.

### Companion Does Not Connect to Intiface

1. Ensure Intiface Central is running.
2. Ensure Intiface server endpoint is `ws://127.0.0.1:12345`.
3. Ensure local firewall is not blocking loopback traffic.

### No Device Vibration

1. Confirm Intiface sees your device.
2. Confirm the device supports vibration attributes.
3. Trigger known events (enemy death, item pickup, low health) and watch companion logs.

## License

MIT
