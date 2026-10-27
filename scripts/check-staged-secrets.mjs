import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repo = resolve().replaceAll("\\", "/");
const git = (args, options = {}) => execFileSync("git", ["-c", `safe.directory=${repo}`, ...args], options);

const names = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bapi[_-]?key\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,}["']/i,
];
const violations = [];

for (const name of names) {
  const basename = name.split(/[\\/]/).at(-1);
  if (/^\.env(?:\..*)?$/.test(basename) && basename !== ".env.example" && basename !== ".env.functions.example") {
    violations.push(`${name}: environment files cannot be committed`);
    continue;
  }
  const content = git(["show", `:${name}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (secretPatterns.some((pattern) => pattern.test(content))) violations.push(`${name}: staged content looks like an API key`);
}

if (violations.length) {
  console.error(`Commit blocked:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}
