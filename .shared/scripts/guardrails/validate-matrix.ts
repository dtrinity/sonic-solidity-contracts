#!/usr/bin/env ts-node

import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { logger } from '../../lib/logger';

type TaskName = 'lint' | 'compile' | 'test';
const DEFAULT_TASKS: TaskName[] = ['lint', 'compile', 'test'];
const SUPPORTED_TASKS = new Set(DEFAULT_TASKS);
type ResultTaskName = TaskName | 'install';

type PackageManager = 'npm' | 'yarn' | 'pnpm';

type CommandOverrides = Partial<Record<TaskName, string>>;

type RepoDefinition = {
  name: string;
  path: string;
  tasks?: TaskName[];
  install?: boolean;
  commands?: CommandOverrides;
};

type RepoRunConfig = {
  name: string;
  path: string;
  tasks: TaskName[];
  runInstall: boolean;
  overrides: CommandOverrides;
};

type ValidationConfig = {
  tasks?: TaskName[];
  install?: boolean;
  commands?: CommandOverrides;
  repos?: RepoDefinition[];
};

type TaskResult = {
  task: ResultTaskName;
  status: 'passed' | 'failed' | 'skipped';
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  message?: string;
};

type RepoResult = {
  name: string;
  path: string;
  packageManager: PackageManager;
  results: TaskResult[];
};

type SummaryReport = {
  startedAt: string;
  finishedAt: string;
  repos: Array<RepoResult & { success: boolean }>;
  success: boolean;
};

function collectStrings(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function parseTask(value: string): TaskName {
  if (!SUPPORTED_TASKS.has(value as TaskName)) {
    throw new Error(`Unsupported task '${value}'. Supported tasks: ${Array.from(SUPPORTED_TASKS).join(', ')}`);
  }
  return value as TaskName;
}

function parseRepoArg(value: string): RepoDefinition {
  const [name, repoPath] = value.split('=');
  if (!name || !repoPath) {
    throw new Error(`Invalid --repo value '${value}'. Use the format name=/absolute/or/relative/path`);
  }
  return { name, path: repoPath };
}

function parseCommandOverride(value: string): [TaskName, string] {
  const [task, ...commandParts] = value.split('=');
  if (!task || commandParts.length === 0) {
    throw new Error(`Invalid --command value '${value}'. Use the format task="command".`);
  }
  const taskName = parseTask(task.trim());
  const command = commandParts.join('=').trim();
  if (!command) {
    throw new Error(`Command override for task '${task}' cannot be empty.`);
  }
  return [taskName, command];
}

function loadConfig(configPath: string | undefined): ValidationConfig {
  if (!configPath) {
    return {};
  }

  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found at ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8');
  try {
    const parsed = JSON.parse(raw) as ValidationConfig;
    return parsed ?? {};
  } catch (error) {
    throw new Error(`Failed to parse config file at ${resolvedPath}: ${(error as Error).message}`);
  }
}

function resolvePackageManager(repoPath: string, packageJson: any): PackageManager {
  const packageManagerField = typeof packageJson.packageManager === 'string' ? packageJson.packageManager : '';
  if (packageManagerField.includes('pnpm')) {
    return 'pnpm';
  }
  if (packageManagerField.includes('yarn')) {
    return 'yarn';
  }

  if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function loadPackageJson(repoPath: string): any {
  const packageJsonPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in ${repoPath}`);
  }
  const raw = fs.readFileSync(packageJsonPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse package.json in ${repoPath}: ${(error as Error).message}`);
  }
}

function hasScript(packageJson: any, scriptName: string): boolean {
  return Boolean(packageJson?.scripts && typeof packageJson.scripts[scriptName] === 'string');
}

function isPlaceholderTestScript(script: string | undefined): boolean {
  if (!script) {
    return false;
  }
  const normalized = script.replace(/\s+/g, ' ').toLowerCase();
  return normalized.includes('error: no test specified') && normalized.includes('exit 1');
}

function buildRunScriptCommand(packageManager: PackageManager, scriptName: string): string {
  switch (packageManager) {
    case 'yarn':
      return `yarn run ${scriptName}`;
    case 'pnpm':
      return `pnpm run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

function buildInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'yarn':
      return 'yarn install';
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    default:
      return 'npm install';
  }
}

function buildNpxCommand(binary: string, args: string[]): string {
  const joinedArgs = args.join(' ');
  return `npx ${binary} ${joinedArgs}`.trim();
}

type CommandResolution = { command: string } | { skip: true; reason: string };

type ResolveContext = {
  packageJson: any;
  packageManager: PackageManager;
  repoPath: string;
  overrides: CommandOverrides;
};

function resolveTaskCommand(task: TaskName, context: ResolveContext): CommandResolution {
  const { overrides } = context;
  const override = overrides[task];
  if (override) {
    return { command: override };
  }

  switch (task) {
    case 'lint':
      return resolveLintCommand(context);
    case 'compile':
      return resolveCompileCommand(context);
    case 'test':
      return resolveTestCommand(context);
    default:
      return { skip: true, reason: `Task '${task}' is not recognized.` };
  }
}

function resolveLintCommand(context: ResolveContext): CommandResolution {
  const { packageJson, packageManager, repoPath } = context;
  if (hasScript(packageJson, 'lint:eslint')) {
    return { command: buildRunScriptCommand(packageManager, 'lint:eslint') };
  }
  if (hasScript(packageJson, 'lint')) {
    return { command: buildRunScriptCommand(packageManager, 'lint') };
  }

  const sharedLintScript = path.join(repoPath, '.shared', 'scripts', 'linting', 'eslint.ts');
  if (fs.existsSync(sharedLintScript)) {
    return { command: buildNpxCommand('ts-node', ['.shared/scripts/linting/eslint.ts']) };
  }

  return { skip: true, reason: 'No lint task or shared lint script found.' };
}

function resolveCompileCommand(context: ResolveContext): CommandResolution {
  const { packageJson, packageManager } = context;
  if (hasScript(packageJson, 'compile')) {
    return { command: buildRunScriptCommand(packageManager, 'compile') };
  }

  return { command: buildNpxCommand('hardhat', ['compile']) };
}

function resolveTestCommand(context: ResolveContext): CommandResolution {
  const { packageJson, packageManager } = context;
  if (hasScript(packageJson, 'test')) {
    const script = packageJson.scripts.test as string | undefined;
    if (isPlaceholderTestScript(script)) {
      return { skip: true, reason: 'Test script is a placeholder (no tests configured).' };
    }

    switch (packageManager) {
      case 'yarn':
        return { command: 'yarn test' };
      case 'pnpm':
        return { command: 'pnpm test' };
      default:
        return { command: 'npm test' };
    }
  }

  if (hasScript(packageJson, 'hardhat:test')) {
    return { command: buildRunScriptCommand(packageManager, 'hardhat:test') };
  }

  return { command: buildNpxCommand('hardhat', ['test']) };
}

function runCommand(command: string, cwd: string): { exitCode: number | null; durationMs: number } {
  const start = Date.now();
  const result = spawnSync(command, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
    },
  });

  const durationMs = Date.now() - start;
  const exitCode = typeof result.status === 'number' ? result.status : result.signal === null ? 0 : 1;
  return { exitCode, durationMs };
}

function ensureAbsolutePath(repoPath: string): string {
  return path.isAbsolute(repoPath) ? repoPath : path.resolve(repoPath);
}

function validateRepo(config: RepoRunConfig): RepoResult {
  const repoPath = ensureAbsolutePath(config.path);
  const results: TaskResult[] = [];

  if (!fs.existsSync(repoPath)) {
    logger.error(`Repository path ${repoPath} does not exist.`);
    return {
      name: config.name,
      path: repoPath,
      packageManager: 'npm',
      results: [
        {
          task: 'install',
          status: 'failed',
          message: 'Repository path does not exist.',
        },
      ],
    };
  }

  const packageJson = loadPackageJson(repoPath);
  const packageManager = resolvePackageManager(repoPath, packageJson);

  if (config.runInstall) {
    const installCommand = buildInstallCommand(packageManager);
    logger.info(`[${config.name}] Installing dependencies via: ${installCommand}`);
    const { exitCode, durationMs } = runCommand(installCommand, repoPath);
    results.push({
      task: 'install',
      status: exitCode === 0 ? 'passed' : 'failed',
      command: installCommand,
      exitCode,
      durationMs,
      message: exitCode === 0 ? undefined : 'Package installation failed.',
    });
    if (exitCode !== 0) {
      logger.error(`[${config.name}] Dependency installation failed (exit code ${exitCode}). Skipping remaining tasks.`);
      return {
        name: config.name,
        path: repoPath,
        packageManager,
        results,
      };
    }
  }

  for (const task of config.tasks) {
    logger.info(`[${config.name}] Preparing ${task} task.`);
    const resolution = resolveTaskCommand(task, {
      packageJson,
      packageManager,
      repoPath,
      overrides: config.overrides ?? {},
    });

    if ('skip' in resolution) {
      if (resolution.skip) {
        const message = resolution.reason;
        logger.warn(`[${config.name}] Skipping ${task}: ${message}`);
        results.push({
          task,
          status: 'skipped',
          message,
        });
        continue;
      }
      // fall through to handle command when skip exists but is false (should not happen)
    }

    const command = (resolution as { command: string }).command;
    logger.info(`[${config.name}] Running ${task} via: ${command}`);
    const { exitCode, durationMs } = runCommand(command, repoPath);
    const status = exitCode === 0 ? 'passed' : 'failed';
    const message = exitCode === 0 ? undefined : `${task} command exited with code ${exitCode}.`;
    if (status === 'passed') {
      logger.success(`[${config.name}] ${task} passed in ${Math.round(durationMs / 100) / 10}s.`);
    } else {
      logger.error(`[${config.name}] ${task} failed (exit code ${exitCode}).`);
    }
    results.push({ task, status, command, exitCode, durationMs, message });
    if (status === 'failed') {
      break;
    }
  }

  return {
    name: config.name,
    path: repoPath,
    packageManager,
    results,
  };
}

function buildRepoRunConfigs(
  definitions: RepoDefinition[],
  defaultTasks: TaskName[],
  globalInstall: boolean,
  configOverrides: CommandOverrides,
  cliOverrides: CommandOverrides
): RepoRunConfig[] {
  return definitions.map(def => ({
    name: def.name,
    path: def.path,
    tasks: (def.tasks && def.tasks.length > 0 ? def.tasks : defaultTasks).filter(task => SUPPORTED_TASKS.has(task)),
    runInstall: def.install ?? globalInstall,
    overrides: {
      ...configOverrides,
      ...(def.commands ?? {}),
      ...cliOverrides,
    },
  }));
}

function summarise(results: RepoResult[]): void {
  const failures: RepoResult[] = [];
  for (const repo of results) {
    const failedTask = repo.results.find(result => result.status === 'failed');
    if (failedTask) {
      failures.push(repo);
    }
  }

  if (failures.length === 0) {
    logger.success('All repositories passed the validation matrix.');
  } else {
    logger.error('Validation matrix detected failures in the following repositories:');
    for (const repo of failures) {
      const failedTask = repo.results.find(result => result.status === 'failed');
      if (failedTask) {
        logger.error(`- ${repo.name}: ${failedTask.task} (${failedTask.message ?? 'command failed'})`);
      }
    }
  }
}

function writeReport(reportPath: string, summary: SummaryReport): void {
  const resolvedPath = path.isAbsolute(reportPath) ? reportPath : path.resolve(reportPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(summary, null, 2));
  logger.success(`Wrote validation report to ${resolvedPath}`);
}

function computeSummaryReport(results: RepoResult[], startedAt: Date, finishedAt: Date): SummaryReport {
  const repos = results.map(repo => ({
    ...repo,
    success: !repo.results.some(result => result.status === 'failed'),
  }));
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    repos,
    success: repos.every(repo => repo.success),
  };
}

function main(): void {
  const program = new Command();

  program
    .description('Run shared guardrail checks across multiple repositories.')
    .option('--config <path>', 'Path to validation config JSON file.')
    .option('--repo <name=path>', 'Repository to validate (repeatable).', collectStrings, [])
    .option('--task <name>', 'Task to run (lint, compile, test). Repeat for multiple tasks.', collectStrings, [])
    .option('--install', 'Run package installation in each repository before executing tasks.')
    .option('--report <path>', 'Write a JSON summary report to the provided path.')
    .option('--command <task=command>', 'Override the command used for a task (repeatable).', collectStrings, []);

  program.parse(process.argv);

  const options = program.opts<{
    config?: string;
    repo?: string[];
    task?: string[];
    install?: boolean;
    report?: string;
    command?: string[];
  }>();

  const config = loadConfig(options.config);

  const configRepos = Array.isArray(config.repos) ? config.repos : [];
  const cliRepos = (options.repo ?? []).map(parseRepoArg);
  const repoDefinitions: RepoDefinition[] = [...configRepos, ...cliRepos];

  if (repoDefinitions.length === 0) {
    logger.error('No repositories provided. Use --repo name=path or specify repos in a config file.');
    process.exit(1);
  }

  const globalTasksFromConfig = Array.isArray(config.tasks) ? config.tasks : undefined;
  const tasksFromCli = (options.task ?? []).map(parseTask);
  const defaultTasks = tasksFromCli.length > 0
    ? tasksFromCli
    : globalTasksFromConfig && globalTasksFromConfig.length > 0
      ? globalTasksFromConfig
      : DEFAULT_TASKS;

  const cliOverridesEntries = (options.command ?? []).map(parseCommandOverride);
  const cliOverrides: CommandOverrides = Object.fromEntries(cliOverridesEntries);
  const configOverrides: CommandOverrides = config.commands ?? {};

  const runInstall = options.install ?? Boolean(config.install);

  const repoRunConfigs = buildRepoRunConfigs(
    repoDefinitions,
    defaultTasks,
    runInstall,
    configOverrides,
    cliOverrides
  );
  const results: RepoResult[] = [];

  const runStartedAt = new Date();

  for (const repoConfig of repoRunConfigs) {
    logger.info(`\n=== Validating ${repoConfig.name} ===`);
    try {
      const repoResult = validateRepo(repoConfig);
      results.push(repoResult);
    } catch (error) {
      logger.error(`Failed to validate ${repoConfig.name}: ${(error as Error).message}`);
      results.push({
        name: repoConfig.name,
        path: ensureAbsolutePath(repoConfig.path),
        packageManager: 'npm',
        results: [
          {
            task: 'install',
            status: 'failed',
            message: (error as Error).message,
          },
        ],
      });
    }
  }

  summarise(results);

  const runFinishedAt = new Date();
  const summary = computeSummaryReport(results, runStartedAt, runFinishedAt);

  if (options.report) {
    writeReport(options.report, summary);
  }

  if (!summary.success) {
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    logger.error(`Validation matrix failed: ${(error as Error).message}`);
    process.exit(1);
  }
}

export {
  RepoDefinition,
  RepoRunConfig,
  RepoResult,
  TaskName,
  ValidationConfig,
  validateRepo,
  buildRepoRunConfigs,
  resolvePackageManager,
  DEFAULT_TASKS,
  SUPPORTED_TASKS,
};
