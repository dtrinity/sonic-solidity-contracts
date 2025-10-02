#!/usr/bin/env ts-node

import { configLoader } from '../../lib/config-loader';
import { logger } from '../../lib/logger';
import { execCommand, getNetworkName } from '../../lib/utils';
import * as path from 'path';
import * as fs from 'fs';

interface SolhintOptions {
  network?: string;
  configFile?: string;
  formatter?: string;
  quiet?: boolean;
  maxWarnings?: number;
}

export function runSolhint(options: SolhintOptions = {}): boolean {
  const network = options.network || getNetworkName();

  logger.info(`Running Solhint linter${network ? ` for network: ${network}` : ''}`);

  // Check if solhint is installed
  try {
    require.resolve('solhint');
  } catch {
    logger.error('Solhint is not installed. Install it with: npm install -D solhint');
    return false;
  }

  // Determine config file
  let configPath = options.configFile;
  if (!configPath) {
    // Check for project-specific config
    const projectConfigPath = path.join(process.cwd(), '.solhint.json');
    if (fs.existsSync(projectConfigPath)) {
      configPath = projectConfigPath;
    } else {
      // Use shared config
      try {
        const config = configLoader.loadConfig('solhint', { network });
        // Write config to temp file
        const tempConfigPath = path.join(process.cwd(), '.solhint.temp.json');
        fs.writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));
        configPath = tempConfigPath;
      } catch (error) {
        logger.warn('No Solhint configuration found, using defaults');
      }
    }
  }

  // Build command
  let command = 'npx solhint';

  if (configPath) {
    command += ` -c ${configPath}`;
  }

  if (options.formatter) {
    command += ` -f ${options.formatter}`;
  }

  if (options.quiet) {
    command += ' --quiet';
  }

  if (options.maxWarnings !== undefined) {
    command += ` --max-warnings ${options.maxWarnings}`;
  }

  // Add files to lint
  command += ' "contracts/**/*.sol"';

  // Execute Solhint
  logger.info('Executing Solhint...');
  const result = execCommand(command, { stdio: 'inherit' });

  // Clean up temp config if created
  const tempConfigPath = path.join(process.cwd(), '.solhint.temp.json');
  if (fs.existsSync(tempConfigPath)) {
    fs.unlinkSync(tempConfigPath);
  }

  if (!result.success) {
    logger.error('Solhint found issues');
    return false;
  }

  logger.success('Solhint analysis completed successfully');
  return true;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: SolhintOptions = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--config':
        options.configFile = args[++i];
        break;
      case '--formatter':
        options.formatter = args[++i];
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--max-warnings':
        options.maxWarnings = parseInt(args[++i]);
        break;
    }
  }

  const success = runSolhint(options);
  process.exit(success ? 0 : 1);
}