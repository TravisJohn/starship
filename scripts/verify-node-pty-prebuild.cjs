const { spawnSync } = require("node:child_process");
const electronPath = require("electron");

const result = spawnSync(
  electronPath,
  [
    "-e",
    "const pty = require('node-pty'); if (typeof pty.spawn !== 'function') process.exit(2);"
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1"
    },
    stdio: "inherit"
  }
);

if (result.status === 0) {
  console.warn(
    "electron-rebuild failed, but node-pty prebuild loaded under Electron."
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
