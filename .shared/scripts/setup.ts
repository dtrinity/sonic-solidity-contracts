#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../lib/logger';

const HARDHAT_CONFIG_FILES = [
  'hardhat.config.ts',
  'hardhat.config.js',
  'hardhat.config.cjs',
  'hardhat.config.mjs'
];

type SetupPhase = 'hooks' | 'configs' | 'ci' | 'packageScripts';

type PhaseOutcome = 'applied' | 'unchanged' | 'skipped' | 'manual-action' | 'error';

interface PhaseResult {
  phase: SetupPhase;
  outcome: PhaseOutcome;
  messages: string[];
}

interface SetupOptions {
  phases: Set<SetupPhase>;
  force: boolean;
  includePreCommitHook: boolean;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

interface SetupContext {
  projectRoot: string;
  sharedRoot: string;
  packageJsonPath: string;
  packageJson?: PackageJson;
  packageJsonParseError?: Error;
  hardhatConfigs: string[];
  gitHooksDir?: string;
}

interface PreflightResult {
  errors: string[];
  warnings: string[];
}

const REQUIRED_SCRIPTS: Record<string, string> = {
  'analyze:shared': 'ts-node .shared/scripts/analysis/run-all.ts',
  'lint:eslint': 'ts-node .shared/scripts/linting/eslint.ts',
  'lint:prettier': 'ts-node .shared/scripts/linting/prettier.ts',
  'lint:all': 'ts-node .shared/scripts/linting/run-all.ts',
  'guardrails:check': 'ts-node .shared/scripts/guardrails/check.ts',
  'shared:update': 'bash .shared/scripts/subtree/update.sh'
};

const LEGACY_SCRIPT_REPLACEMENTS: Record<string, string[]> = {
  'analyze:shared': [
    'npm run --prefix .shared analyze:all'
  ],
  'lint:eslint': ['npm run --prefix .shared lint:eslint'],
  'lint:prettier': ['npm run --prefix .shared lint:prettier'],
  'lint:all': ['npm run --prefix .shared lint:all'],
  'guardrails:check': ['npm run --prefix .shared guardrails:check']
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const context = collectContext();

  const preflight = runPreflight(context, options);
  if (preflight.errors.length > 0) {
    logger.error('Preflight checks failed:');
    preflight.errors.forEach((error) => logger.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  if (preflight.warnings.length > 0) {
    logger.warn('Preflight warnings:');
    preflight.warnings.forEach((warning) => logger.warn(`- ${warning}`));
  }

  const results: PhaseResult[] = [];

  if (options.phases.has('packageScripts')) {
    results.push(applyPackageScripts(context, options.force));
  }
  if (options.phases.has('hooks')) {
    results.push(applyGitHooks(context, options));
  }
  if (options.phases.has('configs')) {
    results.push(applyConfigs(context, options.force));
  }
  if (options.phases.has('ci')) {
    results.push(applyCIWorkflows(context, options.force));
  }

  summarize(results);

  if (results.some((result) => result.outcome === 'error')) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): SetupOptions {
  const phases = new Set<SetupPhase>();
  let force = false;
  let explicitPhaseSelection = false;
  let includePreCommitHook = false;

  for (const arg of args) {
    switch (arg) {
      case '--hooks':
        phases.add('hooks');
        explicitPhaseSelection = true;
        break;
      case '--configs':
        phases.add('configs');
        explicitPhaseSelection = true;
        break;
      case '--ci':
        phases.add('ci');
        explicitPhaseSelection = true;
        break;
      case '--package-scripts':
        phases.add('packageScripts');
        explicitPhaseSelection = true;
        break;
      case '--all':
        phases.add('hooks');
        phases.add('configs');
        phases.add('ci');
        phases.add('packageScripts');
        explicitPhaseSelection = true;
        break;
      case '--force':
        force = true;
        break;
      case '--include-pre-commit-hook':
      case '--with-pre-commit-hook':
      case '--include-pre-commit':
      case '--with-pre-commit':
        includePreCommitHook = true;
        break;
      default:
        logger.warn(`Unknown argument: ${arg}`);
    }
  }

  if (!explicitPhaseSelection) {
    phases.add('hooks');
    phases.add('configs');
    phases.add('ci');
    phases.add('packageScripts');
  }

  return { phases, force, includePreCommitHook };
}

function collectContext(): SetupContext {
  const projectRoot = process.cwd();
  const sharedRoot = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(projectRoot, 'package.json');

  let packageJson: PackageJson | undefined;
  let packageJsonParseError: Error | undefined;
  if (fs.existsSync(packageJsonPath)) {
    try {
      const raw = fs.readFileSync(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(raw) as PackageJson;
    } catch (error) {
      packageJsonParseError = error as Error;
    }
  }

  const hardhatConfigs = HARDHAT_CONFIG_FILES
    .map((config) => path.join(projectRoot, config))
    .filter((configPath) => fs.existsSync(configPath));

  const gitHooksDir = resolveGitHooksDir(projectRoot);

  return {
    projectRoot,
    sharedRoot,
    packageJsonPath,
    packageJson,
    packageJsonParseError,
    hardhatConfigs,
    gitHooksDir
  };
}

function runPreflight(context: SetupContext, options: SetupOptions): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const expectedSharedDir = path.join(context.projectRoot, '.shared');
  if (path.resolve(expectedSharedDir) !== path.resolve(context.sharedRoot)) {
    errors.push('Run this script from the Hardhat project root (unable to locate .shared directory).');
  } else if (!fs.existsSync(context.sharedRoot)) {
    errors.push('Expected .shared directory is missing. Ensure the subtree is integrated before running setup.');
  }

  if (!context.packageJson) {
    if (context.packageJsonParseError) {
      errors.push(`Failed to parse package.json: ${context.packageJsonParseError.message}`);
    } else {
      errors.push('No package.json found in project root.');
    }
  }

  if (context.hardhatConfigs.length === 0) {
    errors.push('No hardhat.config.* file found in project root.');
  }

  if (!isInsideGitRepo(context.projectRoot)) {
    errors.push('Not inside a git repository.');
  }

  if (options.phases.has('hooks') && !context.gitHooksDir) {
    errors.push('Unable to determine git hooks directory.');
  }

  if (options.phases.has('hooks')) {
    const sharedHooksDir = path.join(context.sharedRoot, 'hooks');
    if (!fs.existsSync(sharedHooksDir)) {
      errors.push('Shared hooks directory is missing.');
    }
  }

  if (options.phases.has('configs')) {
    const sharedConfigsDir = path.join(context.sharedRoot, 'configs');
    if (!fs.existsSync(sharedConfigsDir)) {
      errors.push('Shared configs directory is missing.');
    }
  }

  if (options.phases.has('ci')) {
    const sharedCiDir = path.join(context.sharedRoot, 'ci');
    if (!fs.existsSync(sharedCiDir)) {
      errors.push('Shared CI directory is missing.');
    }
    const workflowsDir = path.join(context.projectRoot, '.github', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
      warnings.push('Project lacks .github/workflows; it will be created if CI workflows are installed.');
    }
  }

  const packageJson = context.packageJson;
  if (packageJson) {
    const hasSharedDependency = Boolean(
      packageJson.dependencies?.['@dtrinity/shared-hardhat-tools'] ||
      packageJson.devDependencies?.['@dtrinity/shared-hardhat-tools']
    );
    if (!hasSharedDependency) {
      warnings.push('Package.json does not list @dtrinity/shared-hardhat-tools; install it via npm/yarn for consistent behavior.');
    }

    const hasHardhatDependency = Boolean(
      packageJson.dependencies?.hardhat || packageJson.devDependencies?.hardhat
    );
    if (!hasHardhatDependency) {
      warnings.push('Hardhat dependency not detected in package.json. Confirm this repository is a Hardhat project.');
    }
  }

  return { errors, warnings };
}

function applyPackageScripts(context: SetupContext, force: boolean): PhaseResult {
  const packageJson = context.packageJson;
  if (!packageJson) {
    return {
      phase: 'packageScripts',
      outcome: 'error',
      messages: ['Cannot update package scripts without a valid package.json']
    };
  }

  if (!packageJson.scripts) {
    packageJson.scripts = {};
  }

  const added: string[] = [];
  const normalized: string[] = [];
  const conflicts: string[] = [];

  for (const [name, desiredCommand] of Object.entries(REQUIRED_SCRIPTS)) {
    const existingCommand = packageJson.scripts[name];

    if (!existingCommand) {
      packageJson.scripts[name] = desiredCommand;
      added.push(name);
      continue;
    }

    if (commandsMatch(existingCommand, desiredCommand)) {
      continue;
    }

    if (shouldReplaceLegacyCommand(name, existingCommand)) {
      packageJson.scripts[name] = desiredCommand;
      normalized.push(`${name} (replaced legacy command)`);
      continue;
    }

    if (force) {
      packageJson.scripts[name] = desiredCommand;
      normalized.push(`${name} (forced overwrite)`);
      continue;
    }

    conflicts.push(`${name} (found "${existingCommand}")`);
  }

  if (added.length === 0 && normalized.length === 0 && conflicts.length === 0) {
    return {
      phase: 'packageScripts',
      outcome: 'unchanged',
      messages: ['All shared scripts already present.']
    };
  }

  if (conflicts.length > 0) {
    const messages = conflicts.map((conflict) => `Manual follow-up required for script ${conflict}.`);
    if (added.length > 0 || normalized.length > 0) {
      writePackageJson(context.packageJsonPath, packageJson);
      if (added.length > 0) {
        messages.unshift(`Added scripts: ${added.join(', ')}.`);
      }
      if (normalized.length > 0) {
        messages.unshift(`Standardized scripts: ${normalized.join(', ')}.`);
      }
    }
    return {
      phase: 'packageScripts',
      outcome: 'manual-action',
      messages
    };
  }

  writePackageJson(context.packageJsonPath, packageJson);

  const messages: string[] = [];
  if (added.length > 0) {
    messages.push(`Added scripts: ${added.join(', ')}.`);
  }
  if (normalized.length > 0) {
    messages.push(`Standardized scripts: ${normalized.join(', ')}.`);
  }

  return {
    phase: 'packageScripts',
    outcome: 'applied',
    messages
  };
}

function applyGitHooks(context: SetupContext, options: SetupOptions): PhaseResult {
  const gitHooksDir = context.gitHooksDir;
  if (!gitHooksDir) {
    return {
      phase: 'hooks',
      outcome: 'error',
      messages: ['Unable to locate git hooks directory.']
    };
  }

  const sharedHooksDir = path.join(context.sharedRoot, 'hooks');
  const hooks = ['pre-push'];
  if (options.includePreCommitHook) {
    hooks.push('pre-commit');
  }
  const installed: string[] = [];
  const skipped: string[] = [];
  const manual: string[] = [];

  if (!fs.existsSync(gitHooksDir)) {
    fs.mkdirSync(gitHooksDir, { recursive: true });
  }

  for (const hook of hooks) {
    const sourcePath = path.join(sharedHooksDir, hook);
    if (!fs.existsSync(sourcePath)) {
      manual.push(`${hook} (shared hook missing)`);
      continue;
    }

    const targetPath = path.join(gitHooksDir, hook);

    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      fs.chmodSync(targetPath, 0o755);
      installed.push(`${hook} (new)`);
      continue;
    }

    const targetContent = fs.readFileSync(targetPath, 'utf-8');
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');

    if (targetContent === sourceContent) {
      skipped.push(`${hook} (already up to date)`);
      continue;
    }

    if (options.force) {
      fs.copyFileSync(sourcePath, targetPath);
      fs.chmodSync(targetPath, 0o755);
      installed.push(`${hook} (overwritten with --force)`);
      continue;
    }

    manual.push(`${hook} (existing hook differs; use --force to overwrite)`);
  }

  const result = buildPhaseResult('hooks', installed, skipped, manual);
  if (!options.includePreCommitHook) {
    result.messages.push('Pre-commit hook not installed (rerun with --include-pre-commit-hook to opt in).');
  }

  return result;
}

function applyConfigs(context: SetupContext, force: boolean): PhaseResult {
  const sharedConfigsDir = path.join(context.sharedRoot, 'configs');
  const configs = [
    { name: 'slither.json', target: '.slither.json' },
    { name: 'solhint.json', target: '.solhint.json' }
  ];

  const installed: string[] = [];
  const skipped: string[] = [];
  const manual: string[] = [];

  for (const config of configs) {
    const sourcePath = path.join(sharedConfigsDir, config.name);
    if (!fs.existsSync(sourcePath)) {
      manual.push(`${config.name} (shared config missing)`);
      continue;
    }

    const targetPath = path.join(context.projectRoot, config.target);

    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      installed.push(`${config.target} (new)`);
      continue;
    }

    const targetContent = fs.readFileSync(targetPath, 'utf-8');
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');

    if (targetContent === sourceContent) {
      skipped.push(`${config.target} (already up to date)`);
      continue;
    }

    if (force) {
      fs.copyFileSync(sourcePath, targetPath);
      installed.push(`${config.target} (overwritten with --force)`);
      continue;
    }

    manual.push(`${config.target} (existing config differs; use --force to overwrite)`);
  }

  return buildPhaseResult('configs', installed, skipped, manual);
}

function applyCIWorkflows(context: SetupContext, force: boolean): PhaseResult {
  const sharedCiDir = path.join(context.sharedRoot, 'ci');
  const workflows = ['shared-guardrails.yml'];
  const workflowsDir = path.join(context.projectRoot, '.github', 'workflows');

  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const installed: string[] = [];
  const skipped: string[] = [];
  const manual: string[] = [];

  for (const workflow of workflows) {
    const sourcePath = path.join(sharedCiDir, workflow);
    if (!fs.existsSync(sourcePath)) {
      manual.push(`${workflow} (shared workflow missing)`);
      continue;
    }

    const targetPath = path.join(workflowsDir, workflow);

    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      installed.push(`${workflow} (new)`);
      continue;
    }

    const targetContent = fs.readFileSync(targetPath, 'utf-8');
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');

    if (targetContent === sourceContent) {
      skipped.push(`${workflow} (already up to date)`);
      continue;
    }

    if (force) {
      fs.copyFileSync(sourcePath, targetPath);
      installed.push(`${workflow} (overwritten with --force)`);
      continue;
    }

    manual.push(`${workflow} (existing workflow differs; use --force to overwrite)`);
  }

  return buildPhaseResult('ci', installed, skipped, manual);
}

function buildPhaseResult(
  phase: SetupPhase,
  installed: string[],
  skipped: string[],
  manual: string[]
): PhaseResult {
  const messages: string[] = [];

  if (installed.length > 0) {
    messages.push(`Installed/updated: ${installed.join(', ')}.`);
  }
  if (skipped.length > 0) {
    messages.push(`Already up to date: ${skipped.join(', ')}.`);
  }
  if (manual.length > 0) {
    messages.push(`Manual review required: ${manual.join(', ')}.`);
  }

  let outcome: PhaseOutcome = 'unchanged';
  if (installed.length > 0) {
    outcome = 'applied';
  } else if (manual.length > 0) {
    outcome = 'manual-action';
  } else if (skipped.length > 0) {
    outcome = 'unchanged';
  } else {
    outcome = 'skipped';
  }

  return { phase, outcome, messages };
}

function summarize(results: PhaseResult[]): void {
  logger.info('Setup summary:');
  for (const result of results) {
    const header = `${result.phase} -> ${result.outcome}`;
    switch (result.outcome) {
      case 'applied':
        logger.success(header);
        break;
      case 'manual-action':
        logger.warn(header);
        break;
      case 'error':
        logger.error(header);
        break;
      default:
        logger.info(header);
        break;
    }
    result.messages.forEach((message) => logger.info(`  ${message}`));
  }
}

function resolveGitHooksDir(projectRoot: string): string | undefined {
  const gitPath = path.join(projectRoot, '.git');
  if (!fs.existsSync(gitPath)) {
    return undefined;
  }

  const stats = fs.statSync(gitPath);
  if (stats.isDirectory()) {
    return path.join(gitPath, 'hooks');
  }

  if (stats.isFile()) {
    try {
      const content = fs.readFileSync(gitPath, 'utf-8');
      const match = content.match(/gitdir:\s*(.*)/i);
      if (match && match[1]) {
        const gitDir = match[1].trim();
        const resolved = path.resolve(projectRoot, gitDir);
        return path.join(resolved, 'hooks');
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function isInsideGitRepo(projectRoot: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore', cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

function commandsMatch(existing: string, desired: string): boolean {
  return normalizeCommand(existing) === normalizeCommand(desired);
}

function normalizeCommand(command: string): string {
  return command
    .replace(/node_modules\/\.bin\//g, '')
    .replace(/^npx\s+/, '')
    .replace(/^yarn\s+/, '')
    .replace(/^pnpm exec\s+/, '')
    .trim();
}

function shouldReplaceLegacyCommand(scriptName: string, existing: string): boolean {
  const replacements = LEGACY_SCRIPT_REPLACEMENTS[scriptName];
  if (!replacements) {
    return false;
  }
  return replacements.some((legacy) => legacy === existing.trim());
}

function writePackageJson(packageJsonPath: string, packageJson: PackageJson): void {
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

main();
