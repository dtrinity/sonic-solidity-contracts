import fs from 'fs';
import path from 'path';

import { findProjectRoot } from '../utils';

export type ContractAddressFormat = 'markdown' | 'json';

export interface ContractAddressRow {
  file: string;
  address: string | null;
}

export interface ContractAddressReport {
  network: string;
  rows: ContractAddressRow[];
}

export interface ContractAddressOptions {
  network: string;
  deploymentsDir?: string;
  includeEmpty?: boolean;
  sort?: boolean;
}

const DEFAULT_DEPLOYMENTS_DIR = 'deployments';
const MIGRATIONS_FILENAME = '.migrations.json';

function resolveDeploymentsRoot(projectRoot: string, deploymentsDir?: string): string {
  if (!deploymentsDir) {
    return path.join(projectRoot, DEFAULT_DEPLOYMENTS_DIR);
  }

  return path.isAbsolute(deploymentsDir)
    ? deploymentsDir
    : path.join(projectRoot, deploymentsDir);
}

function readJsonFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as unknown;
}

export function collectContractAddresses(options: ContractAddressOptions): ContractAddressReport {
  const projectRoot = findProjectRoot();
  const deploymentsRoot = resolveDeploymentsRoot(projectRoot, options.deploymentsDir);
  const networkDir = path.join(deploymentsRoot, options.network);

  if (!fs.existsSync(networkDir) || !fs.statSync(networkDir).isDirectory()) {
    throw new Error(`Network directory does not exist: ${networkDir}`);
  }

  const entries = fs
    .readdirSync(networkDir)
    .filter(file => file.endsWith('.json') && file !== MIGRATIONS_FILENAME);

  const rows: ContractAddressRow[] = [];

  for (const file of entries) {
    const absolutePath = path.join(networkDir, file);
    let address: string | null = null;

    try {
      const json = readJsonFile(absolutePath) as { address?: string | null };
      if (typeof json.address === 'string' && json.address.trim().length > 0) {
        address = json.address;
      }
    } catch (error) {
      throw new Error(`Failed to parse ${absolutePath}: ${String(error)}`);
    }

    if (!address && options.includeEmpty !== true) {
      continue;
    }

    rows.push({
      file,
      address,
    });
  }

  if (options.sort !== false) {
    rows.sort((a, b) => a.file.localeCompare(b.file));
  }

  return {
    network: options.network,
    rows,
  };
}

export function renderContractAddressReport(
  report: ContractAddressReport,
  format: ContractAddressFormat = 'markdown'
): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const lines = ['| Name | Address |', '|------|---------|'];

  for (const row of report.rows) {
    const address = row.address ? `\`${row.address}\`` : 'N/A';
    lines.push(`| ${row.file.replace(/\\.json$/, '')} | ${address} |`);
  }

  return lines.join('\n');
}
