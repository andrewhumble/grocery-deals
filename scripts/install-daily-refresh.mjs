import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const hour = Number(process.env.PANTRY_REFRESH_HOUR ?? "7");
if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("PANTRY_REFRESH_HOUR must be an integer from 0 through 23.");

const agentDirectory = path.join(homedir(), "Library", "LaunchAgents");
const agentPath = path.join(agentDirectory, "com.pantry-signal.daily-refresh.plist");
const workspace = process.cwd();
const logPath = path.join(workspace, "data", "refresh.log");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.pantry-signal.daily-refresh</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(workspace, "scripts", "refresh-all.mjs")}</string></array>
  <key>WorkingDirectory</key><string>${workspace}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict></plist>`;

await mkdir(agentDirectory, { recursive: true });
await writeFile(agentPath, plist);
console.log(`Created ${agentPath}.`);
console.log("Activate it with:");
console.log(`launchctl bootstrap gui/$(id -u) ${agentPath}`);
if (existsSync(agentPath)) console.log(`It will refresh all sources daily at ${hour.toString().padStart(2, "0")}:00 local time after activation.`);
