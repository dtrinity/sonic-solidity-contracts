import fs from 'fs';
import path from 'path';

import { sync as globSync } from 'glob';
import { findProjectRoot } from '../utils';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SolidityMetricsContainer } = require('solidity-code-metrics');

export interface NSLOCRow {
  file: string;
  nsloc: number;
  lines: number;
  comments: number;
}

export interface NSLOCReport {
  rows: NSLOCRow[];
  errors: string[];
  totalNSLOC: number;
}

export interface NSLOCOptions {
  contractsDir?: string;
  ignore?: string[];
}

const DEFAULT_CONTRACTS_DIR = 'contracts';
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.shared/**', '**/artifacts/**', '**/cache/**'];

function resolveContractsRoot(projectRoot: string, contractsDir?: string): string {
  if (!contractsDir) {
    return path.join(projectRoot, DEFAULT_CONTRACTS_DIR);
  }

  return path.isAbsolute(contractsDir)
    ? contractsDir
    : path.join(projectRoot, contractsDir);
}

export function generateNSLOCReport(options: NSLOCOptions = {}): NSLOCReport {
  const projectRoot = findProjectRoot();
  const contractsRoot = resolveContractsRoot(projectRoot, options.contractsDir);

  if (!fs.existsSync(contractsRoot) || !fs.statSync(contractsRoot).isDirectory()) {
    throw new Error(`Contracts directory does not exist: ${contractsRoot}`);
  }

  const ignorePatterns = options.ignore && options.ignore.length > 0
    ? options.ignore
    : DEFAULT_IGNORE;

  const files = globSync('**/*.sol', {
    cwd: contractsRoot,
    absolute: true,
    ignore: ignorePatterns,
  }).sort();

  const container = new SolidityMetricsContainer('nsloc-report', {
    basePath: contractsRoot,
  });

  for (const file of files) {
    container.analyze(file);
  }

  const rows: NSLOCRow[] = container.metrics.map((metric: { filename: string; metrics: any }) => ({
    file: path.relative(projectRoot, metric.filename),
    nsloc: metric.metrics.nsloc?.source ?? 0,
    lines: metric.metrics.sloc?.source ?? 0,
    comments: metric.metrics.sloc?.comment ?? 0,
  }));

  rows.sort((a, b) => a.file.localeCompare(b.file));

  const totalNSLOC = rows.reduce((total, row) => total + row.nsloc, 0);
  const errors = Array.isArray(container.errors)
    ? container.errors.map((file: string) => path.relative(projectRoot, file))
    : [];

  return {
    rows,
    errors,
    totalNSLOC,
  };
}

export function renderNSLOCReport(report: NSLOCReport): string {
  const lines: string[] = [];
  lines.push('# nSLOC Report');
  lines.push('');
  lines.push(`Total normalized SLOC: ${report.totalNSLOC}`);
  lines.push(`Files analyzed: ${report.rows.length}`);
  lines.push('');
  lines.push('| File | nSLOC | Source Lines | Comment Lines |');
  lines.push('|------|-------|--------------|---------------|');

  for (const row of report.rows) {
    lines.push(`| ${row.file} | ${row.nsloc} | ${row.lines} | ${row.comments} |`);
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push('## Files with parsing errors');
    for (const errorFile of report.errors) {
      lines.push(`- ${errorFile}`);
    }
  }

  return lines.join('\n');
}
