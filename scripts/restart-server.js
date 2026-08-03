import { execSync, spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const out = execSync("netstat -ano", { encoding: "utf8" });
const pids = new Set();
for (const line of out.split("\n")) {
  if (line.includes(":3847") && line.includes("LISTENING")) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.add(pid);
  }
}
for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "inherit" });
  } catch {
    /* ignore */
  }
}

const child = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
child.unref();
console.log("Server startet, pid", child.pid);
