#!/usr/bin/env ts-node

import { configLoader } from '../../lib/config-loader';
import { logger } from '../../lib/logger';
import { execCommand, isCommandAvailable, getNetworkName } from '../../lib/utils';
import * as path from 'path';

interface SlitherOptions {
  network?: string;
  outputFile?: string;
  configFile?: string;
  failOnHigh?: boolean;
  failOnMedium?: boolean;
}

export function runSlither(options: SlitherOptions = {}): boolean {
  const network = options.network || getNetworkName();

  logger.info(`Running Slither analysis${network ? ` for network: ${network}` : ''}`);

  // Check if slither is installed
  if (!isCommandAvailable('slither')) {
    logger.error('Slither is not installed. Install it with: pip install slither-analyzer');
    return false;
  }

  // Load configuration
  let configPath = options.configFile;
  if (!configPath) {
    try {
      const config = configLoader.loadConfig('slither', { network });
      // Write config to temp file if loaded from shared configs
      const tempConfigPath = path.join(process.cwd(), '.slither.config.json');
      require('fs').writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));
      configPath = tempConfigPath;
    } catch (error) {
      logger.warn('No Slither configuration found, using defaults');
    }
  }

  // Build command
  let command = 'slither .';
  if (configPath) {
    command += ` --config-file ${configPath}`;
  }
  if (options.outputFile) {
    command += ` --json ${options.outputFile}`;
  }

  // Execute Slither
  logger.info('Executing Slither...');
  const result = execCommand(command, { stdio: 'inherit' });

  if (!result.success) {
    logger.error('Slither analysis failed');

    // Parse output for severity levels if available
    if (result.output) {
      const hasHighSeverity = result.output.includes('High:') || result.output.includes('high impact');
      const hasMediumSeverity = result.output.includes('Medium:') || result.output.includes('medium impact');

      if (options.failOnHigh && hasHighSeverity) {
        logger.error('High severity issues detected');
        return false;
      }
      if (options.failOnMedium && hasMediumSeverity) {
        logger.error('Medium severity issues detected');
        return false;
      }
    }

    return false;
  }

  logger.success('Slither analysis completed successfully');
  return true;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: SlitherOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--output':
        options.outputFile = args[++i];
        break;
      case '--config':
        options.configFile = args[++i];
        break;
      case '--fail-on-high':
        options.failOnHigh = true;
        break;
      case '--fail-on-medium':
        options.failOnMedium = true;
        break;
    }
  }

  const success = runSlither(options);
  process.exit(success ? 0 : 1);
}