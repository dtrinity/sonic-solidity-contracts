import fs from 'fs';
import path from 'path';

import { findProjectRoot } from '../utils';

export interface OracleCategoryDefinition {
  name: string;
  include?: string[];
  exclude?: string[];
}

export interface OracleNetworkReport {
  categories: Record<string, string[]>;
  uncategorized: string[];
}

export type OracleReport = Record<string, OracleNetworkReport>;

export interface OracleReportOptions {
  deploymentsDir?: string;
  networks?: string[];
  skipNetworks?: string[];
  categories?: OracleCategoryDefinition[];
  includeEmpty?: boolean;
  caseSensitive?: boolean;
}

const DEFAULT_DEPLOYMENTS_DIR = 'deployments';
const MIGRATIONS_FILENAME = '.migrations.json';

const DEFAULT_CATEGORIES: OracleCategoryDefinition[] = [
  { name: 'Redstone', include: ['Redstone'] },
  { name: 'API3', include: ['API3'] },
  { name: 'Chainlink', include: ['Chainlink'], exclude: ['Factory'] },
  { name: 'CurveAPI3', include: ['CurveAPI3'] },
  { name: 'HardPegOracle', include: ['HardPegOracle'] },
];

function resolveDeploymentsRoot(projectRoot: string, deploymentsDir?: string): string {
  if (!deploymentsDir) {
    return path.join(projectRoot, DEFAULT_DEPLOYMENTS_DIR);
  }

  return path.isAbsolute(deploymentsDir)
    ? deploymentsDir
    : path.join(projectRoot, deploymentsDir);
}

function listNetworks(deploymentsRoot: string): string[] {
  return fs
    .readdirSync(deploymentsRoot)
    .filter(entry => {
      const fullPath = path.join(deploymentsRoot, entry);
      return fs.statSync(fullPath).isDirectory() && !entry.startsWith('.');
    })
    .sort();
}

function readAddress(filePath: string): string | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw) as { address?: string | null };
  if (typeof json.address === 'string' && json.address.trim().length > 0) {
    return json.address;
  }
  return null;
}

function normalizePatterns(patterns: string[] | undefined, caseSensitive: boolean): string[] {
  if (!patterns || patterns.length === 0) {
    return [];
  }

  return patterns
    .map(pattern => pattern.trim())
    .filter(pattern => pattern.length > 0)
    .map(pattern => (caseSensitive ? pattern : pattern.toLowerCase()));
}

function fileMatches(
  fileName: string,
  include: string[],
  exclude: string[],
  caseSensitive: boolean
): boolean {
  const target = caseSensitive ? fileName : fileName.toLowerCase();

  const includeMatch = include.length === 0 || include.some(pattern => target.includes(pattern));
  if (!includeMatch) {
    return false;
  }

  if (exclude.length === 0) {
    return true;
  }

  return !exclude.some(pattern => target.includes(pattern));
}

export function generateOracleReport(options: OracleReportOptions = {}): OracleReport {
  const projectRoot = findProjectRoot();
  const deploymentsRoot = resolveDeploymentsRoot(projectRoot, options.deploymentsDir);

  if (!fs.existsSync(deploymentsRoot) || !fs.statSync(deploymentsRoot).isDirectory()) {
    throw new Error(`Deployments directory does not exist: ${deploymentsRoot}`);
  }

  const caseSensitive = options.caseSensitive === true;
  const skipNetworks = new Set((options.skipNetworks ?? []).map(network => network.trim()));
  const targetNetworks = (options.networks && options.networks.length > 0)
    ? options.networks
    : listNetworks(deploymentsRoot).filter(network => !skipNetworks.has(network));

  const categories = (options.categories && options.categories.length > 0)
    ? options.categories
    : DEFAULT_CATEGORIES;

  const normalizedCategories = categories.map(category => ({
    name: category.name,
    include: normalizePatterns(category.include, caseSensitive),
    exclude: normalizePatterns(category.exclude, caseSensitive),
  }));

  const report: OracleReport = {};

  for (const network of targetNetworks) {
    const networkDir = path.join(deploymentsRoot, network);
    if (!fs.existsSync(networkDir) || !fs.statSync(networkDir).isDirectory()) {
      continue;
    }

    const files = fs
      .readdirSync(networkDir)
      .filter(file => file.endsWith('.json') && file !== MIGRATIONS_FILENAME)
      .sort();

    const categoryMap: Record<string, Set<string>> = {};
    const uncategorized = new Set<string>();

    for (const definition of normalizedCategories) {
      categoryMap[definition.name] = new Set();
    }

    for (const file of files) {
      const baseName = file.replace(/\.json$/i, '');
      let address: string | null = null;

      try {
        address = readAddress(path.join(networkDir, file));
      } catch (error) {
        throw new Error(`Failed to parse ${path.join(networkDir, file)}: ${String(error)}`);
      }

      if (!address && options.includeEmpty !== true) {
        continue;
      }

      const matchFound = normalizedCategories.some(definition => {
        if (fileMatches(baseName, definition.include, definition.exclude, caseSensitive)) {
          if (address) {
            categoryMap[definition.name].add(address);
          } else {
            categoryMap[definition.name].add('');
          }
          return true;
        }
        return false;
      });

      if (!matchFound && address) {
        uncategorized.add(address);
      }
    }

    report[network] = {
      categories: Object.fromEntries(
        Object.entries(categoryMap).map(([name, values]) => [
          name,
          Array.from(values).filter(value => value.length > 0),
        ])
      ),
      uncategorized: Array.from(uncategorized),
    };
  }

  return report;
}

export function renderOracleReport(report: OracleReport, asJson = false): string {
  if (asJson) {
    return JSON.stringify(report, null, 2);
  }

  const lines: string[] = [];

  for (const [network, details] of Object.entries(report)) {
    lines.push(`${network}: {`);

    for (const [category, addresses] of Object.entries(details.categories)) {
      const formatted = addresses.length > 0 ? `[
  ${addresses.map(address => `'${address}'`).join(',\n  ')}
]` : '[]';
      lines.push(`  ${category}: ${formatted},`);
    }

    const uncategorized = details.uncategorized;
    const formattedUncategorized = uncategorized.length > 0 ? `[
  ${uncategorized.map(address => `'${address}'`).join(',\n  ')}
]` : '[]';
    lines.push(`  Uncategorized: ${formattedUncategorized}`);
    lines.push('}');
  }

  return lines.join('\n');
}
