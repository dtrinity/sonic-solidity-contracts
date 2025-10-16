#!/usr/bin/env ts-node

import { Command } from 'commander';

import { logger } from '../../lib/logger';
import { runPrettier, PrettierOptions } from './prettier';
import { runEslint, EslintOptions } from './eslint';

interface RunAllOptions {
  skipPrettier?: boolean;
  skipEslint?: boolean;
  prettier?: PrettierOptions;
  eslint?: EslintOptions;
}

export async function runAllLinting(options: RunAllOptions = {}): Promise<boolean> {
  logger.info('Running shared linting suite');

  let success = true;

  if (!options.skipPrettier) {
    logger.info('\n=== Prettier ===');
    const prettierSuccess = await runPrettier(options.prettier);
    success = success && prettierSuccess;

    if (!prettierSuccess && options.prettier?.write !== true) {
      logger.error('Prettier check failed. Run with --write to apply fixes.');
    }
  } else {
    logger.info('Skipping Prettier.');
  }

  if (!options.skipEslint) {
    logger.info('\n=== ESLint ===');
    const eslintSuccess = await runEslint(options.eslint);
    success = success && eslintSuccess;
  } else {
    logger.info('Skipping ESLint.');
  }

  if (success) {
    logger.success('\nLinting completed successfully.');
  } else {
    logger.error('\nLinting completed with failures.');
  }

  return success;
}

if (require.main === module) {
  const program = new Command();

  program
    .description('Run shared Prettier and ESLint checks.')
    .option('--skip-prettier', 'Skip running Prettier.')
    .option('--skip-eslint', 'Skip running ESLint.')
    .option('--write', 'Run Prettier in write mode.')
    .option('--prettier-config <path>', 'Path to a Prettier configuration file.')
    .option('--eslint-config <path>', 'Path to an ESLint configuration file.')
    .option('--eslint-fix', 'Run ESLint with --fix.')
    .option('--eslint-format <name>', 'ESLint formatter name.', 'stylish')
    .option('--eslint-max-warnings <count>', 'Maximum allowed ESLint warnings before failure.', (value: string) => parseInt(value, 10))
    .option('--eslint-quiet', 'Run ESLint in quiet mode.')
    .parse(process.argv);

  const opts = program.opts();

  const eslintOptions: EslintOptions = {
    config: opts.eslintConfig,
    fix: Boolean(opts.eslintFix),
    format: opts.eslintFormat,
    quiet: Boolean(opts.eslintQuiet),
  };

  const maxWarningsOption = opts.eslintMaxWarnings;
  if (typeof maxWarningsOption === 'number' && !Number.isNaN(maxWarningsOption)) {
    eslintOptions.maxWarnings = maxWarningsOption;
  }

  runAllLinting({
    skipPrettier: Boolean(opts.skipPrettier),
    skipEslint: Boolean(opts.skipEslint),
    prettier: {
      write: Boolean(opts.write),
      config: opts.prettierConfig,
    },
    eslint: eslintOptions,
  }).then(success => {
    process.exit(success ? 0 : 1);
  });
}
