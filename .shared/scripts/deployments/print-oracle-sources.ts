#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';

import { Command } from 'commander';

import {
  generateOracleReport,
  renderOracleReport,
  OracleCategoryDefinition,
} from '../../lib/deployments/oracle-report';
import { logger } from '../../lib/logger';
import { findProjectRoot } from '../../lib/utils';

function parseDefinitions(raw: string[] | undefined): Map<string, OracleCategoryDefinition> {
  const definitions = new Map<string, OracleCategoryDefinition>();
  if (!raw) {
    return definitions;
  }

  for (const entry of raw) {
    const [namePart, valuePart] = entry.split('=');
    const name = (namePart ?? '').trim();
    if (name.length === 0) {
      continue;
    }
    const values = (valuePart ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(value => value.length > 0);

    const existing = definitions.get(name) ?? { name, include: [], exclude: [] };
    if (!existing.include) {
      existing.include = [];
    }
    existing.include.push(...values);
    definitions.set(name, existing);
  }

  return definitions;
}

function applyExclusions(definitions: Map<string, OracleCategoryDefinition>, raw: string[] | undefined): void {
  if (!raw) {
    return;
  }

  for (const entry of raw) {
    const [namePart, valuePart] = entry.split('=');
    const name = (namePart ?? '').trim();
    if (name.length === 0) {
      continue;
    }

    const values = (valuePart ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(value => value.length > 0);

    const existing = definitions.get(name) ?? { name, include: [], exclude: [] };
    if (!existing.exclude) {
      existing.exclude = [];
    }
    existing.exclude.push(...values);
    definitions.set(name, existing);
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .description('Aggregate oracle deployment addresses by category.')
    .option('-n, --network <name...>', 'Limit the report to specific network directories.')
    .option('--skip-network <name...>', 'Exclude specific networks from the report.')
    .option('--deployments-dir <path>', 'Deployments directory (defaults to ./deployments).')
    .option('--category <definition...>', 'Category include patterns (e.g. --category Redstone=Redstone,API3).')
    .option('--exclude <definition...>', 'Category exclusion patterns (e.g. --exclude Chainlink=Mock).')
    .option('--include-empty', 'Include entries even when no address is present.')
    .option('--case-sensitive', 'Treat include/exclude patterns as case-sensitive.')
    .option('--json', 'Output JSON instead of formatted text.')
    .option('--output <path>', 'Optional file to write the report to.');

  program.parse(process.argv);
  const options = program.opts();

  const definitionMap = parseDefinitions(options.category as string[] | undefined);
  applyExclusions(definitionMap, options.exclude as string[] | undefined);

  const categories = definitionMap.size > 0 ? Array.from(definitionMap.values()) : undefined;

  try {
    const report = generateOracleReport({
      deploymentsDir: options.deploymentsDir as string | undefined,
      networks: options.network as string[] | undefined,
      skipNetworks: options.skipNetwork as string[] | undefined,
      categories,
      includeEmpty: Boolean(options.includeEmpty),
      caseSensitive: Boolean(options.caseSensitive),
    });

    const asJson = Boolean(options.json);
    const output = renderOracleReport(report, asJson);

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
    logger.error('Failed to generate oracle report.');
    logger.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}

void main();
