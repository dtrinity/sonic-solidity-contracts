#!/usr/bin/env ts-node

import { configLoader } from '../../lib/config-loader';
import { logger } from '../../lib/logger';
import { execCommand, isCommandAvailable, getSolidityFiles } from '../../lib/utils';
import * as path from 'path';

interface MythrilOptions {
  network?: string;
  outputFile?: string;
  contractsDir?: string;
  timeout?: number;
  executionTimeout?: number;
  solcVersion?: string;
}

export function runMythril(options: MythrilOptions = {}): boolean {
  logger.info('Running Mythril security analysis');

  // Check if mythril is installed
  if (!isCommandAvailable('myth')) {
    logger.error('Mythril is not installed. Install it with: pip install mythril');
    return false;
  }

  // Load configuration
  let config: any = {};
  try {
    config = configLoader.loadConfig('mythril', { network: options.network });
  } catch (error) {
    logger.warn('No Mythril configuration found, using defaults');
  }

  // Get contracts to analyze
  const contractsDir = options.contractsDir || config.contractsDir || 'contracts';
  const solidityFiles = getSolidityFiles(contractsDir);

  if (solidityFiles.length === 0) {
    logger.warn(`No Solidity files found in ${contractsDir}`);
    return true;
  }

  logger.info(`Found ${solidityFiles.length} Solidity files to analyze`);

  let allSuccess = true;
  const results: any[] = [];

  // Analyze each contract
  for (const file of solidityFiles) {
    logger.info(`Analyzing ${path.relative(process.cwd(), file)}...`);

    // Build command
    let command = `myth analyze ${file}`;

    // Add options
    if (options.solcVersion || config.solcVersion) {
      command += ` --solv ${options.solcVersion || config.solcVersion}`;
    }
    if (options.executionTimeout || config.executionTimeout) {
      command += ` --execution-timeout ${options.executionTimeout || config.executionTimeout}`;
    }
    if (config.maxDepth) {
      command += ` --max-depth ${config.maxDepth}`;
    }

    // Execute Mythril
    const result = execCommand(command, {
      timeout: (options.timeout || config.timeout || 300) * 1000 // Convert to milliseconds
    });

    if (!result.success) {
      logger.error(`Mythril analysis failed for ${file}`);
      allSuccess = false;

      // Check if it's a timeout
      if (result.error?.includes('ETIMEDOUT')) {
        logger.warn('Analysis timed out - consider increasing timeout');
      }
    } else if (result.output?.includes('==== ')) {
      // Mythril found issues
      logger.warn(`Security issues found in ${file}`);
      results.push({
        file,
        issues: result.output
      });
    } else {
      logger.success(`No issues found in ${file}`);
    }
  }

  // Save results if output file specified
  if (options.outputFile && results.length > 0) {
    const fs = require('fs');
    fs.writeFileSync(
      options.outputFile,
      JSON.stringify(results, null, 2)
    );
    logger.info(`Results saved to ${options.outputFile}`);
  }

  if (!allSuccess) {
    logger.error('Mythril analysis completed with errors');
    return false;
  }

  logger.success('Mythril analysis completed successfully');
  return results.length === 0;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: MythrilOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--output':
        options.outputFile = args[++i];
        break;
      case '--contracts':
        options.contractsDir = args[++i];
        break;
      case '--timeout':
        options.timeout = parseInt(args[++i]);
        break;
      case '--solc-version':
        options.solcVersion = args[++i];
        break;
    }
  }

  const success = runMythril(options);
  process.exit(success ? 0 : 1);
}