#!/usr/bin/env node

import { Command } from 'commander';
import hre from 'hardhat';

import { logger } from '../../logger';
import { runOraclePriceInspector } from './runner';
import type { OracleInspectorOptions } from './types';

function printTextResult(result: Awaited<ReturnType<typeof runOraclePriceInspector>>): void {
  logger.info(`Oracle price report for ${result.network}`);
  logger.info('='.repeat(60));

  if (result.aggregators.length === 0) {
    logger.warn('No aggregators discovered.');
    return;
  }

  for (const aggregator of result.aggregators) {
    logger.info(`\nAggregator: ${aggregator.key} @ ${aggregator.address}`);
    logger.info('-'.repeat(60));

    if (aggregator.assets.length === 0) {
      logger.warn('  (no assets discovered)');
      continue;
    }

    for (const asset of aggregator.assets) {
      const label = asset.symbol ?? asset.address;
      const lines = [
        `  ${label} (${asset.address})`,
        `    aggregatorPrice : ${asset.aggregatorPrice ?? 'n/a'}`,
      ];

      if (asset.source) {
        lines.push(`    wrapper        : ${asset.source}`);
      }
      if (asset.wrapperPrice) {
        lines.push(`    wrapperPrice   : ${asset.wrapperPrice}`);
      }
      if (asset.wrapperAlive !== undefined) {
        lines.push(`    wrapperAlive   : ${asset.wrapperAlive}`);
      }
      if (asset.notes && asset.notes.length > 0) {
        for (const note of asset.notes) {
          lines.push(`    note           : ${note}`);
        }
      }

      for (const line of lines) {
        logger.info(line);
      }
    }
  }
}

export async function runOraclePriceCli(): Promise<void> {
  const program = new Command();

  program
    .option('-a, --aggregators <list>', 'Comma separated list of aggregator keys')
    .option('--asset <address...>', 'Extra asset addresses to inspect')
    .option('--json', 'Output JSON instead of text')
    .option('--multicall <address>', 'Override multicall3 address')
    .option('--skip-wrapper-checks', 'Skip wrapper price comparisons')
    .option('--chunk-size <number>', 'Multicall chunk size', value => Number(value));

  program.parse(process.argv);
  const opts = program.opts();

  const parsed: OracleInspectorOptions = {
    aggregators: opts.aggregators ? String(opts.aggregators).split(',').map((value: string) => value.trim()).filter(Boolean) : undefined,
    assets: opts.asset as string[] | undefined,
    json: Boolean(opts.json),
    multicallAddress: opts.multicall as string | undefined,
    skipWrapperChecks: Boolean(opts.skipWrapperChecks),
    chunkSize: typeof opts.chunkSize === 'number' && !Number.isNaN(opts.chunkSize) ? opts.chunkSize : undefined,
  };

  try {
    const result = await runOraclePriceInspector(hre, parsed);
    if (parsed.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printTextResult(result);
    }
  } catch (error) {
    logger.error((error as Error).message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runOraclePriceCli();
}
