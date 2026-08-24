const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const sourceConfig = path.join(rootDir, "config.json");
const outDir = path.join(rootDir, "out");
const outConfig = path.join(outDir, "config.json");

if (!fs.existsSync(sourceConfig)) {
  console.error("[build] ERROR: source config.json not found.");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(sourceConfig, outConfig);

console.log("[build] OK: copied config.json to out/config.json");
