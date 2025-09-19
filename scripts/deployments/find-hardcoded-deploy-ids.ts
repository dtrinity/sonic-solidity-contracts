import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");
const deployIdsPath = path.join(repoRoot, "typescript", "deploy-ids.ts");
const deployScriptsRoot = path.join(repoRoot, "deploy");

const deployIdRegex = /export const ([A-Z0-9_]+)\s*=\s*["'`]([^"'`]+)["'`]/g;

type DeployIdEntry = {
  constantName: string;
  value: string;
};

type Finding = {
  file: string;
  lineNumber: number;
  constantName: string;
  value: string;
  line: string;
};

function loadDeployIds(): DeployIdEntry[] {
  if (!fs.existsSync(deployIdsPath)) {
    throw new Error(`Could not find deploy-ids file at ${deployIdsPath}`);
  }

  const fileContent = fs.readFileSync(deployIdsPath, "utf8");
  const entries: DeployIdEntry[] = [];

  for (const match of fileContent.matchAll(deployIdRegex)) {
    const [, constantName, value] = match;

    if (!constantName || !value) continue;

    entries.push({ constantName, value });
  }

  return entries;
}

function collectDeployScriptPaths(root: string): string[] {
  const results: string[] = [];

  const walk = (currentPath: string) => {
    const stats = fs.statSync(currentPath);

    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath)) {
        walk(path.join(currentPath, entry));
      }
      return;
    }

    if (stats.isFile() && currentPath.endsWith(".ts")) {
      results.push(currentPath);
    }
  };

  walk(root);

  return results;
}

function removeBlockComments(line: string, inBlockComment: boolean): { text: string; inBlockComment: boolean } {
  let text = "";
  let index = 0;
  let insideComment = inBlockComment;

  while (index < line.length) {
    if (!insideComment && line.startsWith("/*", index)) {
      insideComment = true;
      index += 2;
      continue;
    }

    if (insideComment) {
      const end = line.indexOf("*/", index);
      if (end === -1) {
        return { text, inBlockComment: true };
      }
      insideComment = false;
      index = end + 2;
      continue;
    }

    text += line[index];
    index += 1;
  }

  return { text, inBlockComment: false };
}

function shouldConsiderLine(line: string): boolean {
  const relevantTokens = ["deployments", "func", "module.exports"];
  return relevantTokens.some((token) => line.includes(token));
}

function shouldSkipDueToContext(line: string): boolean {
  if (line.includes("contract:")) return true;
  if (line.includes("getContractAt(")) return true;
  if (line.includes("getContractFactory(")) return true;
  if (line.includes("ethers.getContractAt")) return true;
  if (line.includes("func.dependencies")) return true;
  if (line.includes("func.tags")) return true;
  return false;
}

function findHardcodedIds(deployIds: DeployIdEntry[], filePaths: string[]): Finding[] {
  const valueToId = new Map<string, string>(deployIds.map((entry) => [entry.value, entry.constantName]));
  const findings: Finding[] = [];

  for (const filePath of filePaths) {
    const relativePath = path.relative(repoRoot, filePath);
    const fileContent = fs.readFileSync(filePath, "utf8");
    const lines = fileContent.split(/\r?\n/);

    let inBlockComment = false;

    lines.forEach((line, index) => {
      const commentStripped = removeBlockComments(line, inBlockComment);
      inBlockComment = commentStripped.inBlockComment;

      const withoutBlock = commentStripped.text;
      const withoutLineComment = withoutBlock.split("//")[0];
      const trimmed = withoutLineComment.trim();

      if (!trimmed) return;
      if (!shouldConsiderLine(trimmed)) return;
      if (shouldSkipDueToContext(trimmed)) return;

      for (const [value, constantName] of valueToId.entries()) {
        const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp("([\"'`])" + escapedValue + "\\1", "g");
        const matches = [...withoutLineComment.matchAll(pattern)];

        if (matches.length === 0) {
          continue;
        }

        for (const match of matches) {
          const matchIndex = match.index ?? 0;
          const beforeMatch = withoutLineComment.slice(0, matchIndex);

          if (/contract\s*:\s*$/.test(beforeMatch)) {
            continue;
          }

          findings.push({
            file: relativePath,
            lineNumber: index + 1,
            constantName,
            value,
            line: trimmed,
          });
          break;
        }
      }
    });
  }

  return findings;
}

function main(): void {
  try {
    const deployIds = loadDeployIds();
    const deployScriptPaths = collectDeployScriptPaths(deployScriptsRoot);
    const findings = findHardcodedIds(deployIds, deployScriptPaths);

    if (findings.length === 0) {
      console.log("✅ No hard-coded deployment IDs detected in deploy scripts.");
      return;
    }

    console.log("⚠️  Detected hard-coded deployment IDs. Replace them with constants from typescript/deploy-ids.ts:");
    for (const finding of findings) {
      console.log(
        `  - ${finding.file}:${finding.lineNumber} uses literal "${finding.value}" (should use ${finding.constantName})\n    ${finding.line}`,
      );
    }

    process.exitCode = 1;
  } catch (error) {
    console.error("Failed to scan deployment scripts for hard-coded IDs:", error);
    process.exitCode = 1;
  }
}

main();
