import { spawnSync } from "node:child_process";

const executable = process.platform === "win32" ? "supabase.exe" : "supabase";
const args = ["db", "push", "--linked", "--include-seed", "--yes"];
let result = spawnSync(executable, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error?.code === "ENOENT") {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  result = spawnSync(npx, ["--yes", "supabase", ...args], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
if (result.error) console.error("Could not start Supabase CLI. Install it or ensure npx can access it.");
process.exit(result.status ?? 1);
