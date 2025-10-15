#!/usr/bin/env ts-node

import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { configLoader } from '../../lib/config-loader';
import { logger } from '../../lib/logger';
import { ensureSlitherInstalled } from '../../lib/slither-installer';
import { execCommand, getNetworkName } from '../../lib/utils';

type SlitherMode = 'legacy' | 'default' | 'check' | 'focused';

interface SlitherOptions {
  network?: string;
  outputFile?: string;
  configFile?: string;
  failOnHigh?: boolean;
  failOnMedium?: boolean;
  filterPaths?: string;
  target?: string;
}

interface ResolvedConfig {
  configPath?: string;
  configData?: Record<string, unknown> | undefined;
}

interface WorkflowConfig {
  mode: SlitherMode;
  network?: string;
  configPath?: string;
  configData?: Record<string, unknown> | undefined;
  filterPaths?: string;
  reportDir: string;
  jsonPath: string;
  summaryPath?: string;
  prints: string[];
  failOnHigh?: boolean;
  failOnMedium?: boolean;
  allowFailure: boolean;
  target: string;
  skipSummary?: boolean;
}

const DEFAULT_REPORT_DIR = path.join('reports', 'slither');
const DEFAULT_JSON_BASENAME = 'slither-report.json';
const DEFAULT_SUMMARY_FILE = path.join('reports', 'slither-summary.md');
const FOCUSED_JSON_BASENAME = 'slither-focused-report.json';
const FOCUSED_SUMMARY_FILE = path.join('reports', 'slither-focused-summary.md');

export function runSlither(options: SlitherOptions = {}): boolean {
  return runSlitherLegacy(options);
}

function runSlitherLegacy(options: SlitherOptions = {}): boolean {
  if (!ensureSlitherInstalled()) {
    return false;
  }

  const cleanupTasks: Array<() => void> = [];

  try {
    const { configPath } = resolveConfigPath(options.network, options.configFile, cleanupTasks);
    const filterPaths = options.filterPaths;

    const baseArgs = buildBaseArgs(options.target ?? '.', configPath, filterPaths);
    const commandArgs = [...baseArgs];

    if (options.outputFile) {
      commandArgs.push('--json', options.outputFile);
      ensureParentDir(options.outputFile);
    }

    if (options.failOnHigh) {
      commandArgs.push('--fail-high');
    }

    if (options.failOnMedium) {
      commandArgs.push('--fail-medium');
    }

    const result = runSlitherCommand(commandArgs);

    if (!result.success) {
      logger.error('Slither analysis failed');
      return false;
    }

    logger.success('Slither analysis completed successfully');
    return true;
  } finally {
    runCleanup(cleanupTasks);
  }
}

function runWorkflow(config: WorkflowConfig): boolean {
  if (!ensureSlitherInstalled()) {
    return false;
  }

  const cleanupTasks: Array<() => void> = [];

  try {
    const { configPath, configData } = resolveConfigPath(config.network, config.configPath, cleanupTasks, config.configData);

    const filterPaths = config.filterPaths ?? resolveFilterPaths(undefined, configData);
    const baseArgs = buildBaseArgs(config.target, configPath, filterPaths);

    const jsonArgs = [...baseArgs];
    if (config.failOnHigh) {
      jsonArgs.push('--fail-high');
    }
    if (config.failOnMedium) {
      jsonArgs.push('--fail-medium');
    }

    ensureDir(config.reportDir);
    ensureParentDir(config.jsonPath);
    jsonArgs.push('--json', config.jsonPath);

    const jsonResult = runSlitherCommand(jsonArgs, { allowFailure: config.allowFailure });

    if (jsonResult.success) {
      logger.info(`JSON report saved to ${relativePath(config.jsonPath)}`);
    }

    if (!jsonResult.success && !config.allowFailure) {
      return false;
    }

    if (!config.skipSummary && config.summaryPath) {
      const summaryArgs = [...baseArgs];
      if (!config.prints.length) {
        summaryArgs.push('--print', 'human-summary');
      } else {
        for (const print of config.prints) {
          summaryArgs.push('--print', print);
        }
      }
      summaryArgs.push('--disable-color');

      const summaryResult = runSlitherCommand(summaryArgs, { captureOutput: true, allowFailure: true });

      if (summaryResult.output) {
        ensureParentDir(config.summaryPath);
        fs.writeFileSync(config.summaryPath, summaryResult.output, 'utf-8');
        logger.info(`Summary saved to ${relativePath(config.summaryPath)}`);
      } else if (!summaryResult.success) {
        logger.warn('Failed to generate Slither summary output.');
      }
    }

    if (!config.allowFailure && !jsonResult.success) {
      return false;
    }

    if (!jsonResult.success) {
      logger.warn('Slither exited with non-zero status. Continuing because allowFailure is enabled.');
    } else {
      logger.success('Slither analysis completed successfully');
    }

    return jsonResult.success || config.allowFailure;
  } finally {
    runCleanup(cleanupTasks);
  }
}

function buildBaseArgs(target: string, configPath?: string, filterPaths?: string): string[] {
  const args = [target];

  if (configPath) {
    args.push('--config-file', configPath);
  }

  if (filterPaths && filterPaths.trim().length > 0) {
    args.push('--filter-paths', filterPaths);
  }

  return args;
}

function runSlitherCommand(
  args: string[],
  options: { captureOutput?: boolean; allowFailure?: boolean } = {}
): ReturnType<typeof execCommand> {
  const command = buildCommand(args);
  logger.debug(`Executing: ${command}`);
  const result = execCommand(command, options.captureOutput ? {} : { stdio: 'inherit' });

  if (!result.success && !options.allowFailure) {
    logger.error('Slither command failed:', result.error);
  }

  return result;
}

function buildCommand(args: string[]): string {
  const quotedArgs = args.map((arg) => quoteArg(arg));
  return ['slither', ...quotedArgs].join(' ');
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_.\/@:=,+-]+$/.test(arg)) {
    return arg;
  }
  return JSON.stringify(arg);
}

function resolveConfigPath(
  network: string | undefined,
  explicitConfig: string | undefined,
  cleanupTasks: Array<() => void>,
  existingConfigData?: Record<string, unknown>
): ResolvedConfig {
  if (explicitConfig) {
    const resolved = path.resolve(explicitConfig);
    return { configPath: resolved, configData: readConfig(resolved) };
  }

  const projectRoot = process.cwd();
  const candidateNames = [
    network ? `slither.${network}.json` : undefined,
    network ? `.slither.${network}.json` : undefined,
    'slither.config.json',
    '.slither.config.json',
    'slither.json',
    '.slither.json'
  ].filter((name): name is string => !!name);

  for (const candidate of candidateNames) {
    const candidatePath = path.join(projectRoot, candidate);
    if (fs.existsSync(candidatePath)) {
      return { configPath: candidatePath, configData: readConfig(candidatePath) };
    }
  }

  if (existingConfigData) {
    return { configPath: undefined, configData: existingConfigData };
  }

  try {
    const config = configLoader.loadConfig('slither', { network });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-hht-slither-'));
    const tempConfigPath = path.join(tempDir, 'slither.config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));
    cleanupTasks.push(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    return { configPath: tempConfigPath, configData: config };
  } catch (error) {
    logger.warn('No Slither configuration found, using defaults');
  }

  return {};
}

function resolveFilterPaths(
  filterPaths: string | string[] | undefined,
  configData?: Record<string, unknown>
): string | undefined {
  if (Array.isArray(filterPaths)) {
    return filterPaths.join(',');
  }

  if (typeof filterPaths === 'string' && filterPaths.trim().length > 0) {
    return filterPaths;
  }

  const value = configData?.['filter_paths'] ?? configData?.['filterPaths'];
  if (Array.isArray(value)) {
    return value.join(',');
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function readConfig(filePath: string): Record<string, unknown> | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    logger.debug(`Failed to parse Slither config at ${filePath}:`, error);
    return undefined;
  }
}

function ensureDir(dir: string): void {
  if (!dir) {
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
}

function runCleanup(cleanupTasks: Array<() => void>): void {
  while (cleanupTasks.length) {
    const task = cleanupTasks.pop();
    if (!task) {
      continue;
    }

    try {
      task();
    } catch (error) {
      logger.debug('Failed to clean up Slither temp asset', error);
    }
  }
}

function relativePath(target: string): string {
  const relative = path.relative(process.cwd(), target);
  return relative || target;
}

if (require.main === module) {
  const program = new Command();

  program
    .argument('[mode]', 'Preset to run: default, check, focused, legacy')
    .option('--mode <mode>', 'Preset to run: default, check, focused, legacy')
    .option('--network <network>', 'Network identifier for config resolution')
    .option('--config <path>', 'Explicit Slither config path')
    .option('--output <path>', 'Override JSON output path (alias: --json-output)')
    .option('--json-output <path>', 'Override JSON output path')
    .option('--summary-output <path>', 'Override summary markdown output path')
    .option('--report-dir <path>', 'Directory for Slither JSON reports', DEFAULT_REPORT_DIR)
    .option('--filter-paths <paths>', 'Comma-separated filter paths for Slither')
    .option('--print <value...>', 'Additional --print modules to include')
    .option('--contract <path>', 'Contract path for focused mode')
    .option('--skip-install', 'Skip Slither auto-installation if missing', false)
    .option('--ensure-only', 'Only ensure Slither is installed, then exit', false)
    .option('--fail-on-high', 'Fail when high severity issues are detected', false)
    .option('--fail-on-medium', 'Fail when medium severity issues are detected', false)
    .option('--target <path>', 'Override the target passed to Slither (legacy mode)');

  program.parse(process.argv);

  const opts = program.opts();
  const [positionalMode] = program.args as string[];

  const requestedMode = (opts.mode ?? positionalMode ?? 'legacy') as string;
  const mode = toMode(requestedMode);

  const network = opts.network ?? getNetworkName();
  const configFile = opts.config as string | undefined;
  const filterPaths = opts.filterPaths as string | undefined;
  const printModules = (opts.print ?? []) as string[];
  const jsonOverride = (opts.jsonOutput ?? opts.output) as string | undefined;
  const summaryOverride = opts.summaryOutput as string | undefined;
  const skipInstall = Boolean(opts.skipInstall);
  const ensureOnly = Boolean(opts.ensureOnly);
  const failOnHigh = Boolean(opts.failOnHigh);
  const failOnMedium = Boolean(opts.failOnMedium);
  const targetOverride = opts.target as string | undefined;

  if (ensureOnly) {
    const installed = ensureSlitherInstalled({ autoInstall: !skipInstall });
    process.exit(installed ? 0 : 1);
  }

  if (!ensureSlitherInstalled({ autoInstall: !skipInstall })) {
    process.exit(1);
  }

  let success = false;

  switch (mode) {
    case 'legacy':
      success = runSlitherLegacy({
        network,
        configFile,
        outputFile: jsonOverride,
        failOnHigh,
        failOnMedium,
        filterPaths,
        target: targetOverride
      });
      break;
    case 'default': {
      const jsonPath = path.resolve(jsonOverride ?? path.join(opts.reportDir ?? DEFAULT_REPORT_DIR, DEFAULT_JSON_BASENAME));
      const summaryPath = path.resolve(summaryOverride ?? DEFAULT_SUMMARY_FILE);
      const workflow: WorkflowConfig = {
        mode,
        network,
        configPath: configFile,
        reportDir: path.resolve(opts.reportDir ?? DEFAULT_REPORT_DIR),
        jsonPath,
        summaryPath,
        prints: printModules.length ? printModules : ['human-summary'],
        failOnHigh,
        failOnMedium,
        allowFailure: !(failOnHigh || failOnMedium),
        target: '.',
        filterPaths
      };
      success = runWorkflow(workflow);
      break;
    }
    case 'check': {
      const jsonPath = path.resolve(jsonOverride ?? path.join(opts.reportDir ?? DEFAULT_REPORT_DIR, DEFAULT_JSON_BASENAME));
      const summaryPath = path.resolve(summaryOverride ?? DEFAULT_SUMMARY_FILE);
      const workflow: WorkflowConfig = {
        mode,
        network,
        configPath: configFile,
        reportDir: path.resolve(opts.reportDir ?? DEFAULT_REPORT_DIR),
        jsonPath,
        summaryPath,
        prints: printModules.length ? printModules : ['human-summary', 'contract-summary', 'loc'],
        failOnHigh: true,
        failOnMedium,
        allowFailure: false,
        target: '.',
        filterPaths
      };
      success = runWorkflow(workflow);
      break;
    }
    case 'focused': {
      const contractPath = (opts.contract as string | undefined) ?? targetOverride;
      if (!contractPath) {
        logger.error('Focused mode requires a contract path (use --contract=<path>).');
        process.exit(1);
      }

      const jsonPath = path.resolve(
        jsonOverride ?? path.join(opts.reportDir ?? DEFAULT_REPORT_DIR, FOCUSED_JSON_BASENAME)
      );
      const summaryPath = path.resolve(summaryOverride ?? FOCUSED_SUMMARY_FILE);
      const workflow: WorkflowConfig = {
        mode,
        network,
        configPath: configFile,
        reportDir: path.resolve(opts.reportDir ?? DEFAULT_REPORT_DIR),
        jsonPath,
        summaryPath,
        prints: printModules.length ? printModules : ['human-summary', 'contract-summary', 'loc'],
        failOnHigh: true,
        failOnMedium,
        allowFailure: false,
        target: contractPath,
        filterPaths
      };
      success = runWorkflow(workflow);
      break;
    }
    default:
      success = runSlitherLegacy({
        network,
        configFile,
        outputFile: jsonOverride,
        failOnHigh,
        failOnMedium,
        filterPaths,
        target: targetOverride
      });
  }

  process.exit(success ? 0 : 1);
}

function toMode(value: string): SlitherMode {
  const normalized = (value || 'legacy').toLowerCase();
  if (normalized === 'default' || normalized === 'check' || normalized === 'focused' || normalized === 'legacy') {
    return normalized;
  }
  return 'legacy';
}
