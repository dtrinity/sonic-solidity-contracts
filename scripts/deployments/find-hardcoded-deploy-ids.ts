#!/usr/bin/env ts-node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';

import { logger } from '../../lib/logger';
import { findProjectRoot } from '../../lib/utils';

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

const DEFAULT_DEPLOY_ID_CANDIDATES = [
  'typescript/deploy-ids.ts',
  'deploy/deploy-ids.ts',
  'deployments/deploy-ids.ts',
  'scripts/deploy-ids.ts'
];

const DEFAULT_DEPLOY_DIR_CANDIDATES = ['deploy', 'deployments'];

const DIRECTORY_EXCLUDES = new Set(['node_modules', '.git', '.shared', 'artifacts', 'cache', 'out']);

function resolveDeployIdsPath(projectRoot: string, explicitPath?: string): string {
  const candidatePaths = explicitPath ? [explicitPath] : DEFAULT_DEPLOY_ID_CANDIDATES;

  for (const candidate of candidatePaths) {
    const absolutePath = path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }

  const display = explicitPath ? explicitPath : DEFAULT_DEPLOY_ID_CANDIDATES.join(', ');
  throw new Error(`Could not find deploy IDs file. Looked for: ${display}`);
}

function resolveDeployRoots(projectRoot: string, explicitRoots?: string[]): string[] {
  const roots = explicitRoots && explicitRoots.length > 0 ? explicitRoots : DEFAULT_DEPLOY_DIR_CANDIDATES;
  const resolved = roots
    .map(root => (path.isAbsolute(root) ? root : path.join(projectRoot, root)))
    .filter(rootPath => fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory());

  if (resolved.length === 0) {
    const display = roots.join(', ');
    throw new Error(`No deploy directories found. Looked for: ${display}`);
  }

  return resolved;
}

function loadDeployIds(deployIdsPath: string): DeployIdEntry[] {
  const fileContent = fs.readFileSync(deployIdsPath, 'utf8');
  const deployIdRegex = /export const ([A-Z0-9_]+)\s*=\s*["'`]([^"'`]+)["'`]/g;
  const entries: DeployIdEntry[] = [];

  for (const match of fileContent.matchAll(deployIdRegex)) {
    const [, constantName, value] = match;
    if (!constantName || !value) {
      continue;
    }
    entries.push({ constantName, value });
  }

  if (entries.length === 0) {
    logger.warn(`No deploy ID constants found in ${deployIdsPath}.`);
  }

  return entries;
}

function removeBlockComments(line: string, inBlockComment: boolean): { text: string; inBlockComment: boolean } {
  let text = '';
  let index = 0;
  let insideComment = inBlockComment;

  while (index < line.length) {
    if (!insideComment && line.startsWith('/*', index)) {
      insideComment = true;
      index += 2;
      continue;
    }

    if (insideComment) {
      const end = line.indexOf('*/', index);
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
  const relevantTokens = ['deployments', 'func', 'module.exports'];
  return relevantTokens.some(token => line.includes(token));
}

function shouldSkipDueToContext(line: string): boolean {
  if (line.includes('contract:')) return true;
  if (line.includes('getContractAt(')) return true;
  if (line.includes('getContractFactory(')) return true;
  if (line.includes('ethers.getContractAt')) return true;
  if (line.includes('func.dependencies')) return true;
  if (line.includes('func.tags')) return true;
  if (line.includes('func.id')) return true;
  return false;
}

function collectDeployScriptPaths(rootPaths: string[], extensions: string[]): string[] {
  const results: string[] = [];

  const walk = (currentPath: string) => {
    const stats = fs.statSync(currentPath);

    if (stats.isDirectory()) {
      const base = path.basename(currentPath);
      if (DIRECTORY_EXCLUDES.has(base)) {
        return;
      }

      for (const entry of fs.readdirSync(currentPath)) {
        walk(path.join(currentPath, entry));
      }
      return;
    }

    if (stats.isFile()) {
      if (extensions.some(ext => currentPath.endsWith(ext))) {
        results.push(currentPath);
      }
    }
  };

  for (const rootPath of rootPaths) {
    walk(rootPath);
  }

  return results;
}

function buildRegex(value: string): RegExp {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternSource = "([\"'`])" + escapedValue + '\\1';
  return new RegExp(patternSource);
}

function findHardcodedIds(deployIds: DeployIdEntry[], filePaths: string[], projectRoot: string): Finding[] {
  const valueToId = new Map<string, string>(deployIds.map(entry => [entry.value, entry.constantName]));
  const findings: Finding[] = [];

  for (const filePath of filePaths) {
    const relativePath = path.relative(projectRoot, filePath);
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split(/\r?\n/);

    let inBlockComment = false;

    lines.forEach((line, index) => {
      const commentStripped = removeBlockComments(line, inBlockComment);
      inBlockComment = commentStripped.inBlockComment;

      const withoutBlock = commentStripped.text;
      const withoutLineComment = withoutBlock.split('//')[0];
      const trimmed = withoutLineComment.trim();

      if (!trimmed) return;
      if (!shouldConsiderLine(trimmed)) return;
      if (shouldSkipDueToContext(trimmed)) return;

      for (const [value, constantName] of valueToId.entries()) {
        const pattern = buildRegex(value);
        if (!pattern.test(withoutLineComment)) {
          continue;
        }

        const matchIndex = withoutLineComment.search(pattern);
        if (matchIndex === -1) {
          continue;
        }

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
    });
  }

  return findings;
}

function writeReport(reportPath: string, findings: Finding[]): void {
  const directory = path.dirname(reportPath);
  fs.mkdirSync(directory, { recursive: true });
  const payload = {
    findings,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Detect hard-coded deployment IDs in deploy scripts.')
    .option('--deploy-ids <path>', 'Path to the deploy IDs source file (defaults to common locations).')
    .option('--deploy-root <path...>', 'Directory or directories to scan for deploy scripts.')
    .option('--extensions <list>', 'Comma-separated list of file extensions to scan (e.g. ".ts,.js").', '.ts')
    .option('--report <path>', 'Optional path to write a JSON report with findings.')
    .option('--quiet', 'Only output findings and errors.');

  program.parse(process.argv);
  const options = program.opts();

  const projectRoot = findProjectRoot();
  const extensions = String(options.extensions || '.ts')
    .split(',')
    .map((ext: string) => (ext.startsWith('.') ? ext : `.${ext}`));

  try {
    const deployIdsPath = resolveDeployIdsPath(projectRoot, options.deployIds);
    if (!options.quiet) {
      logger.info(`Using deploy IDs from ${path.relative(projectRoot, deployIdsPath)}`);
    }

    const deployRoots = resolveDeployRoots(projectRoot, options.deployRoot);
    if (!options.quiet) {
      logger.info(`Scanning deploy scripts in: ${deployRoots.map(root => path.relative(projectRoot, root)).join(', ')}`);
    }

    const deployIds = loadDeployIds(deployIdsPath);
    if (deployIds.length === 0) {
      logger.warn('No deploy IDs found to compare against.');
    }

    const scriptPaths = collectDeployScriptPaths(deployRoots, extensions);
    if (!options.quiet) {
      logger.info(`Discovered ${scriptPaths.length} deploy script(s) to scan.`);
    }

    const findings = findHardcodedIds(deployIds, scriptPaths, projectRoot);

    if (options.report) {
      const reportPath = path.isAbsolute(options.report)
        ? options.report
        : path.join(projectRoot, options.report);
      writeReport(reportPath, findings);
      if (!options.quiet) {
        logger.info(`Wrote findings report to ${path.relative(projectRoot, reportPath)}`);
      }
    }

    if (findings.length === 0) {
      logger.success('No hard-coded deployment IDs detected in deploy scripts.');
      return;
    }

    logger.warn('Detected hard-coded deployment IDs. Replace them with shared constants:');
    findings.forEach(finding => {
      logger.warn(
        `  - ${finding.file}:${finding.lineNumber} uses literal "${finding.value}" (expected ${finding.constantName})\n    ${finding.line}`,
      );
    });

    process.exitCode = 1;
  } catch (error) {
    logger.error('Failed to inspect deploy scripts for hard-coded IDs.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
