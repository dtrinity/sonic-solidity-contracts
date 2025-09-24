#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';

import { Command } from 'commander';

import { generateNSLOCReport, renderNSLOCReport } from '../../lib/deployments/nsloc';
import { logger } from '../../lib/logger';
import { findProjectRoot } from '../../lib/utils';

const DEFAULT_OUTPUT = 'reports/nsloc.md';

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Generate normalized Source Lines of Code (nSLOC) metrics for Solidity contracts.')
    .option('--contracts-dir <path>', 'Contracts directory (defaults to ./contracts).')
    .option('--ignore <pattern...>', 'Glob patterns to ignore (replaces the default ignore list).')
    .option('--output <path>', 'Destination file for the markdown report.', DEFAULT_OUTPUT)
    .option('--json', 'Emit JSON to stdout instead of markdown.');

  program.parse(process.argv);
  const options = program.opts();

  try {
    const report = generateNSLOCReport({
      contractsDir: options.contractsDir as string | undefined,
      ignore: options.ignore as string[] | undefined,
    });

    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
      return;
    }

    const outputPath = options.output as string;
    const projectRoot = findProjectRoot();
    const targetPath = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(projectRoot, outputPath);

    const markdown = renderNSLOCReport(report);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${markdown}
`);
    logger.success(`nSLOC report written to ${targetPath}`);
  } catch (error) {
    logger.error('Failed to generate nSLOC report.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
