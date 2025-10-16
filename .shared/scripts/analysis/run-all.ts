#!/usr/bin/env ts-node

import { logger } from '../../lib/logger';
import { runSlither } from './slither';
import { runMythril } from './mythril';
import { runSolhint } from './solhint';

interface AnalysisOptions {
  network?: string;
  skipSlither?: boolean;
  skipMythril?: boolean;
  skipSolhint?: boolean;
  failFast?: boolean;
}

export async function runAllAnalysis(options: AnalysisOptions = {}): Promise<boolean> {
  logger.info('Running comprehensive security analysis');

  const results = {
    solhint: { success: true, skipped: false },
    slither: { success: true, skipped: false },
    mythril: { success: true, skipped: false }
  };

  // Run Solhint
  if (!options.skipSolhint) {
    logger.info('\n=== Running Solhint ===');
    results.solhint.success = runSolhint({ network: options.network });
    if (!results.solhint.success && options.failFast) {
      logger.error('Solhint failed, stopping analysis');
      return false;
    }
  } else {
    results.solhint.skipped = true;
    logger.info('Skipping Solhint analysis');
  }

  // Run Slither
  if (!options.skipSlither) {
    logger.info('\n=== Running Slither ===');
    results.slither.success = runSlither({ network: options.network });
    if (!results.slither.success && options.failFast) {
      logger.error('Slither failed, stopping analysis');
      return false;
    }
  } else {
    results.slither.skipped = true;
    logger.info('Skipping Slither analysis');
  }

  // Run Mythril
  if (!options.skipMythril) {
    logger.info('\n=== Running Mythril ===');
    results.mythril.success = runMythril({ network: options.network });
    if (!results.mythril.success && options.failFast) {
      logger.error('Mythril failed, stopping analysis');
      return false;
    }
  } else {
    results.mythril.skipped = true;
    logger.info('Skipping Mythril analysis');
  }

  // Summary
  logger.info('\n=== Analysis Summary ===');
  for (const [tool, result] of Object.entries(results)) {
    if (result.skipped) {
      logger.info(`${tool}: SKIPPED`);
    } else if (result.success) {
      logger.success(`${tool}: PASSED`);
    } else {
      logger.error(`${tool}: FAILED`);
    }
  }

  const allSuccess = Object.values(results).every(r => r.success || r.skipped);
  if (allSuccess) {
    logger.success('\nAll security analyses completed successfully!');
  } else {
    logger.error('\nSome security analyses failed. Please review the issues above.');
  }

  return allSuccess;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: AnalysisOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--skip-slither':
        options.skipSlither = true;
        break;
      case '--skip-mythril':
        options.skipMythril = true;
        break;
      case '--skip-solhint':
        options.skipSolhint = true;
        break;
      case '--fail-fast':
        options.failFast = true;
        break;
    }
  }

  runAllAnalysis(options).then(success => {
    process.exit(success ? 0 : 1);
  });
}