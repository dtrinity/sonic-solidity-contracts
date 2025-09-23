import fs from 'fs';
import path from 'path';

import { findProjectRoot } from '../utils';

export interface CleanDeploymentsOptions {
  network: string;
  keywords: string[];
  deploymentsDir?: string;
  dryRun?: boolean;
  caseSensitive?: boolean;
}

export interface CleanDeploymentsResult {
  migrationsPath: string;
  removedMigrationKeys: string[];
  removedFiles: string[];
  missingFiles: string[];
  dryRun: boolean;
}

const DEFAULT_DEPLOYMENTS_DIR = 'deployments';
const MIGRATIONS_FILENAME = '.migrations.json';

function normalizeKeywords(keywords: string[], caseSensitive: boolean): string[] {
  return keywords
    .map(keyword => keyword.trim())
    .filter(keyword => keyword.length > 0)
    .map(keyword => (caseSensitive ? keyword : keyword.toLowerCase()));
}

function resolveDeploymentsRoot(projectRoot: string, deploymentsDir?: string): string {
  if (!deploymentsDir) {
    return path.join(projectRoot, DEFAULT_DEPLOYMENTS_DIR);
  }

  return path.isAbsolute(deploymentsDir)
    ? deploymentsDir
    : path.join(projectRoot, deploymentsDir);
}

export function cleanDeployments(options: CleanDeploymentsOptions): CleanDeploymentsResult {
  const { network, dryRun = false, caseSensitive = false } = options;
  const keywords = normalizeKeywords(options.keywords, caseSensitive);

  if (keywords.length === 0) {
    throw new Error('At least one keyword must be provided');
  }

  const projectRoot = findProjectRoot();
  const deploymentsRoot = resolveDeploymentsRoot(projectRoot, options.deploymentsDir);
  const networkDir = path.join(deploymentsRoot, network);

  if (!fs.existsSync(networkDir) || !fs.statSync(networkDir).isDirectory()) {
    throw new Error(`Network directory does not exist: ${networkDir}`);
  }

  const migrationsPath = path.join(networkDir, MIGRATIONS_FILENAME);
  if (!fs.existsSync(migrationsPath)) {
    throw new Error(`Migrations file not found at ${migrationsPath}`);
  }

  const migrationsContent = fs.readFileSync(migrationsPath, 'utf8');
  let migrations: Record<string, unknown>;
  try {
    migrations = JSON.parse(migrationsContent) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse migrations file at ${migrationsPath}`);
  }

  const migrationKeys = Object.keys(migrations);
  const removedMigrationKeys: string[] = [];

  const matchesKeyword = (value: string): boolean => {
    const target = caseSensitive ? value : value.toLowerCase();
    return keywords.some(keyword => target.includes(keyword));
  };

  const filteredMigrations: Record<string, unknown> = {};
  for (const key of migrationKeys) {
    if (matchesKeyword(key)) {
      removedMigrationKeys.push(key);
    } else {
      filteredMigrations[key] = migrations[key];
    }
  }

  const removedFiles: string[] = [];
  const missingFiles: string[] = [];

  if (removedMigrationKeys.length > 0) {
    const deploymentFiles = fs
      .readdirSync(networkDir)
      .filter(file => file.endsWith('.json') && file !== MIGRATIONS_FILENAME);

    for (const file of deploymentFiles) {
      if (!matchesKeyword(file)) {
        continue;
      }

      const filePath = path.join(networkDir, file);
      if (dryRun) {
        removedFiles.push(filePath);
        continue;
      }

      try {
        fs.rmSync(filePath, { force: true });
        removedFiles.push(filePath);
      } catch {
        missingFiles.push(filePath);
      }
    }

    if (!dryRun) {
      fs.writeFileSync(migrationsPath, `${JSON.stringify(filteredMigrations, null, 2)}\n`);
    }
  }

  return {
    migrationsPath,
    removedMigrationKeys,
    removedFiles,
    missingFiles,
    dryRun,
  };
}
