#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';

import { logger } from '../../lib/logger';
import { findProjectRoot, loadProjectModule } from '../../lib/utils';

const DEFAULT_PATTERNS = [
  'config/**/*.{ts,js}',
  'deploy/**/*.{ts,js}',
  'scripts/**/*.{ts,js}',
  'test/**/*.{ts,js}',
  'typescript/**/*.{ts,js}',
  '*.{ts,js,cjs,mjs}',
];

const ESLINT_CONFIG_FILES = [
  'eslint.config.mjs',
  'eslint.config.js',
  'eslint.config.cjs',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc',
];

type ESLintModule = {
  ESLint: {
    new (options?: Record<string, unknown>): {
      lintFiles: (patterns: string[]) => Promise<any[]>;
      loadFormatter: (name: string) => Promise<{ format: (results: any[]) => string }>;
    };
    outputFixes: (results: any[]) => Promise<void>;
  };
};

export interface EslintOptions {
  config?: string;
  fix?: boolean;
  format?: string;
  maxWarnings?: number;
  quiet?: boolean;
  patterns?: string[];
}

function resolveConfigPath(projectRoot: string, provided?: string): string {
  if (provided) {
    const candidate = path.resolve(projectRoot, provided);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Provided ESLint config not found at ${candidate}`);
    }
    return candidate;
  }

  for (const candidate of ESLINT_CONFIG_FILES) {
    const candidatePath = path.join(projectRoot, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return path.join(__dirname, '../../configs/eslint.config.mjs');
}

export async function runEslint(options: EslintOptions = {}): Promise<boolean> {
  const projectRoot = findProjectRoot();
  const eslintModule = loadProjectModule<ESLintModule>('eslint', projectRoot);

  if (!eslintModule?.ESLint) {
    logger.error('ESLint is not installed. Install it with: npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin');
    return false;
  }

  const { ESLint } = eslintModule;
  const patterns = options.patterns?.length ? options.patterns : DEFAULT_PATTERNS;
  const configPath = resolveConfigPath(projectRoot, options.config);

  const eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: configPath,
    fix: options.fix ?? false,
    errorOnUnmatchedPattern: false,
  });

  let results: any[] = [];

  try {
    results = await eslint.lintFiles(patterns);
  } catch (error) {
    logger.error('ESLint execution failed:', error);
    return false;
  }

  if (options.fix) {
    await eslintModule.ESLint.outputFixes(results);
  }

  const processedResults = options.quiet
    ? results.map(result => ({
        ...result,
        messages: (result.messages ?? []).filter((message: any) => message.severity === 2),
        warningCount: 0,
        warnings: [],
      }))
    : results;

  const formatterName = options.format || 'stylish';
  try {
    const formatter = await eslint.loadFormatter(formatterName);
    const output = formatter.format(processedResults);
    if (output.trim().length > 0) {
      console.log(output);
    }
  } catch (error) {
    logger.warn(`Failed to load ESLint formatter '${formatterName}':`, error);
  }

  const errorCount = processedResults.reduce(
    (sum: number, result: any) => sum + (result.errorCount ?? 0) + (result.fatalErrorCount ?? 0),
    0,
  );
  const warningCount = processedResults.reduce((sum: number, result: any) => sum + (result.warningCount ?? 0), 0);

  if (typeof options.maxWarnings === 'number' && warningCount > options.maxWarnings) {
    logger.error(`ESLint found ${warningCount} warning(s), which exceeds the configured maximum of ${options.maxWarnings}.`);
    return false;
  }

  if (errorCount > 0) {
    logger.error(`ESLint found ${errorCount} error(s).`);
    return false;
  }

  if (warningCount > 0) {
    logger.warn(`ESLint completed with ${warningCount} warning(s).`);
  }

  logger.success('ESLint checks passed.');
  return true;
}

if (require.main === module) {
  const program = new Command();

  program
    .description('Run ESLint using shared defaults with project overrides.')
    .option('--config <path>', 'Path to an ESLint configuration file.')
    .option('--fix', 'Automatically fix problems where possible.')
    .option('--format <name>', 'Formatter name to use for output.', 'stylish')
    .option('--max-warnings <count>', 'Maximum allowed warnings before failing.', (value: string) => parseInt(value, 10))
    .option('--quiet', 'Report errors only.')
    .option('--pattern <glob>', 'Glob pattern to include (can be repeated).', (value, previous: string[]) => {
      if (previous) {
        return [...previous, value];
      }
      return [value];
    })
    .parse(process.argv);

  const opts = program.opts();
  const patterns = opts.pattern as string[] | undefined;
  const maxWarnings = typeof opts.maxWarnings === 'number' && !Number.isNaN(opts.maxWarnings)
    ? opts.maxWarnings
    : undefined;

  runEslint({
    config: opts.config,
    fix: Boolean(opts.fix),
    format: opts.format,
    maxWarnings,
    quiet: Boolean(opts.quiet),
    patterns,
  }).then(success => {
    process.exit(success ? 0 : 1);
  });
}
