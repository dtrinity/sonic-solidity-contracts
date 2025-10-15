#!/usr/bin/env ts-node

import { Command } from 'commander';

import { installSlither, ensureSlitherInstalled } from '../../lib/slither-installer';
import { logger } from '../../lib/logger';

const program = new Command();

program
  .option('--check', 'Only check if Slither is available (no installation).', false)
  .option('--force', 'Force reinstallation even if Slither is already present.', false)
  .parse(process.argv);

const opts = program.opts<{ check?: boolean; force?: boolean }>();

if (opts.check) {
  const available = ensureSlitherInstalled({ autoInstall: false });
  process.exit(available ? 0 : 1);
}

if (!opts.force && ensureSlitherInstalled({ autoInstall: false })) {
  logger.success('Slither is already installed.');
  process.exit(0);
}

const installed = installSlither();
process.exit(installed ? 0 : 1);
