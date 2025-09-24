#!/usr/bin/env ts-node

import { Command } from 'commander';

import { cleanDeployments } from '../../lib/deployments/cleaner';
import { logger } from '../../lib/logger';

function parseKeywords(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  return raw
    .flatMap(entry => entry.split(',').map(value => value.trim()))
    .filter(entry => entry.length > 0);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Remove deployment artifacts that match one or more keywords.')
    .requiredOption('-n, --network <name>', 'Deployment network to clean.')
    .requiredOption('-k, --keywords <keyword...>', 'Keywords to match against migration entries and file names.')
    .option('--deployments-dir <path>', 'Deployments directory (defaults to ./deployments).')
    .option('--case-sensitive', 'Treat keywords as case-sensitive matches.')
    .option('--dry-run', 'Report matches without deleting files or updating migrations.')
    .option('--json', 'Output the summary as JSON.');

  program.parse(process.argv);
  const options = program.opts();

  const keywords = parseKeywords(options.keywords as string[] | undefined);
  if (keywords.length === 0) {
    logger.error('No keywords provided. Use --keywords <kw1> <kw2> or comma-separated values.');
    process.exitCode = 1;
    return;
  }

  try {
    const result = cleanDeployments({
      network: options.network as string,
      keywords,
      deploymentsDir: options.deploymentsDir as string | undefined,
      caseSensitive: Boolean(options.caseSensitive),
      dryRun: Boolean(options.dryRun),
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
      return;
    }

    if (result.removedMigrationKeys.length === 0) {
      logger.info('No migration entries matched the provided keywords.');
    } else {
      logger.info(`Removed ${result.removedMigrationKeys.length} migration entr${result.removedMigrationKeys.length === 1 ? 'y' : 'ies'}:`);
      result.removedMigrationKeys.forEach(entry => logger.info(`  - ${entry}`));
    }

    if (result.removedFiles.length > 0) {
      logger.info(`Removed ${result.removedFiles.length} deployment file(s).`);
    }

    if (result.missingFiles.length > 0) {
      logger.warn('Some deployment files could not be removed:');
      result.missingFiles.forEach(file => logger.warn(`  - ${file}`));
    }

    if (result.dryRun) {
      logger.info('Dry run complete. No files were modified.');
    }
  } catch (error) {
    logger.error('Failed to clean deployments.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
