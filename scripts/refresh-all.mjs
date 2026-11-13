import { spawn } from "node:child_process";
import path from "node:path";

const jobs = [
  ["Publix", path.join("scripts", "fetch-publix.mjs")],
  ["Costco", path.join("costco", "fetch-weekly-deals.mjs")],
  ["Whole Foods", path.join("wholefoods", "fetch-weekly-deals.mjs")],
];

function run(label, script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args, script], { cwd: process.cwd(), stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${label} refresh failed with exit code ${code}.`)));
  });
}

const failures = [];
for (const [label, script] of jobs) {
  try {
    console.log(`\nRefreshing ${label}…`);
    await run(label, script);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

try {
  console.log("\nBuilding retrieval index…");
  await run("Retrieval index", path.join("scripts", "build-deal-index.ts"), ["--conditions=react-server", "--import", "tsx"]);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  console.error(`\n${failures.length} source refresh${failures.length === 1 ? "" : "es"} failed:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("\nAll deal sources refreshed.");
}
