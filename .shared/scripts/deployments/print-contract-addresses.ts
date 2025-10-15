#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';

import { Command } from 'commander';

import {
  collectContractAddresses,
  renderContractAddressReport,
  ContractAddressFormat,
} from '../../lib/deployments/contracts-report';
import { logger } from '../../lib/logger';
import { findProjectRoot } from '../../lib/utils';

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Generate a report of deployment addresses for a given network.')
    .requiredOption('-n, --network <name>', 'Deployment network to inspect.')
    .option('--deployments-dir <path>', 'Deployments directory (defaults to ./deployments).')
    .option('--include-empty', 'Include entries without an address.')
    .option('--format <format>', 'Output format: markdown or json (default: markdown).', 'markdown')
    .option('--output <path>', 'Optional path to write the report to a file.');

  program.parse(process.argv);
  const options = program.opts();

  const format = (options.format as string).toLowerCase() as ContractAddressFormat;
  if (!['markdown', 'json'].includes(format)) {
    logger.error(`Unsupported format: ${options.format}`);
    process.exitCode = 1;
    return;
  }

  try {
    const report = collectContractAddresses({
      network: options.network as string,
      deploymentsDir: options.deploymentsDir as string | undefined,
      includeEmpty: Boolean(options.includeEmpty),
    });

    const output = format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderContractAddressReport(report, 'markdown');

    if (options.output) {
      const projectRoot = findProjectRoot();
      const targetPath = path.isAbsolute(options.output as string)
        ? (options.output as string)
        : path.join(projectRoot, options.output as string);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, `${output}
`);
      logger.success(`Report written to ${targetPath}`);
    } else {
      process.stdout.write(`${output}
`);
    }
  } catch (error) {
    logger.error('Failed to collect deployment addresses.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
