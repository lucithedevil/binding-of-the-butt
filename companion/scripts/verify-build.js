const fs = require("fs");
const path = require("path");

const outputPath = path.join(__dirname, "..", "out", "companion.exe");

if (!fs.existsSync(outputPath)) {
  console.error("[build] ERROR: out/companion.exe was not created.");
  process.exit(1);
}

const stats = fs.statSync(outputPath);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

console.log(`[build] OK: out/companion.exe created (${sizeMb} MB)`);
