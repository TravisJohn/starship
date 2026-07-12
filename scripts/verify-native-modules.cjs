const { spawnSync } = require("node:child_process");
const electronPath = require("electron");

const verificationSource = `
  const pty = require('node-pty');
  if (typeof pty.spawn !== 'function') process.exit(2);
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('create table starship_native_check(id integer primary key)');
`;

const result = spawnSync(electronPath, ["-e", verificationSource], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1"
  },
  stdio: "inherit"
});

if (result.status === 0) {
  console.warn(
    "electron-rebuild did not complete, but native modules loaded under Electron."
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
