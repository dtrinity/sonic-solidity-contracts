import { execSync, ExecSyncOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

export interface ExecResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Execute a command and return the result
 */
export function execCommand(
  command: string,
  options: ExecSyncOptions = {}
): ExecResult {
  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      ...options
    }) as string;
    return { success: true, output };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      output: error.stdout?.toString()
    };
  }
}

/**
 * Check if a command is available in the system
 */
export function isCommandAvailable(command: string): boolean {
  const result = execCommand(`which ${command}`);
  return result.success;
}

/**
 * Find the project root by looking for package.json
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
  let currentDir = startDir;

  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return startDir;
}

/**
 * Get network name from environment or arguments
 */
export function getNetworkName(): string | undefined {
  // Check command line arguments
  const args = process.argv;
  const networkIndex = args.indexOf('--network');
  if (networkIndex !== -1 && args[networkIndex + 1]) {
    return args[networkIndex + 1];
  }

  // Check environment variable
  return process.env.HARDHAT_NETWORK || process.env.NETWORK;
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL
  );
}

/**
 * Get all Solidity files in a directory
 */
export function getSolidityFiles(dir: string = 'contracts'): string[] {
  const files: string[] = [];
  const fullPath = path.join(process.cwd(), dir);

  if (!fs.existsSync(fullPath)) {
    logger.warn(`Directory ${fullPath} does not exist`);
    return files;
  }

  function walkDir(currentPath: string) {
    const entries = fs.readdirSync(currentPath);

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry);
      const stat = fs.statSync(entryPath);

      if (stat.isDirectory()) {
        walkDir(entryPath);
      } else if (entry.endsWith('.sol')) {
        files.push(entryPath);
      }
    }
  }

  walkDir(fullPath);
  return files;
}