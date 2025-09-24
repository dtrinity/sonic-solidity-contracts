#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import { Command } from 'commander';

import { logger } from '../../lib/logger';
import { findProjectRoot, loadProjectModule } from '../../lib/utils';

const DEFAULT_PATTERNS = [
  'contracts/**/*.sol',
  'deploy/**/*.{ts,js}',
  'scripts/**/*.{ts,js}',
  'config/**/*.{ts,js,json}',
  'test/**/*.{ts,js}',
  'typescript/**/*.{ts,js}',
  '*.{ts,js,json,cjs,mjs}',
];

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/artifacts/**',
  '**/cache/**',
  '**/deployments/**',
  '**/typechain-types/**',
  '**/reports/**',
  '**/.shared/**',
  '**/.yarn/**',
];

export interface PrettierOptions {
  write?: boolean;
  config?: string;
  patterns?: string[];
  ignore?: string[];
}

type PrettierModule = {
  format: (source: string, options: Record<string, unknown>) => Promise<string> | string;
  check: (source: string, options: Record<string, unknown>) => Promise<boolean> | boolean;
  resolveConfig: (filePath: string, options?: { config?: string }) => Promise<Record<string, unknown> | null>;
  resolveConfigFile: (searchPath: string) => Promise<string | null>;
};

async function resolveConfigPath(prettier: PrettierModule, projectRoot: string, provided?: string): Promise<string | null> {
  if (provided) {
    const candidate = path.resolve(projectRoot, provided);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Provided Prettier config not found at ${candidate}`);
    }
    return candidate;
  }

  try {
    const discovered = await prettier.resolveConfigFile(projectRoot);
    if (discovered) {
      return discovered;
    }
  } catch (error) {
    logger.debug('Unable to auto-detect Prettier config:', error);
  }

  return null;
}

async function loadConfigForFile(
  prettier: PrettierModule,
  filePath: string,
  configPath: string | null,
  fallbackConfig: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  try {
    if (configPath) {
      const resolved = await prettier.resolveConfig(filePath, { config: configPath });
      if (resolved) {
        return resolved;
      }
    } else {
      const resolved = await prettier.resolveConfig(filePath);
      if (resolved) {
        return resolved;
      }
    }
  } catch (error) {
    logger.warn(`Failed to resolve Prettier config for ${filePath}:`, error);
  }

  return fallbackConfig ?? {};
}

export async function runPrettier(options: PrettierOptions = {}): Promise<boolean> {
  const projectRoot = findProjectRoot();
  const prettier = loadProjectModule<PrettierModule>('prettier', projectRoot);

  if (!prettier) {
    logger.error('Prettier is not installed. Install it with: npm install -D prettier prettier-plugin-solidity');
    return false;
  }

  const patterns = options.patterns?.length ? options.patterns : DEFAULT_PATTERNS;
  const ignore = Array.from(new Set([...(options.ignore ?? []), ...DEFAULT_IGNORES]));

  const configPath = await resolveConfigPath(prettier, projectRoot, options.config);
  const sharedConfigPath = path.join(__dirname, '../../configs/prettier.config.cjs');
  let fallbackConfig: Record<string, unknown> | null = null;

  if (!configPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const configModule = require(sharedConfigPath);
      fallbackConfig = (configModule.default ?? configModule) as Record<string, unknown>;
    } catch (error) {
      logger.warn('Failed to load shared Prettier config:', error);
    }
  }

  const files = new Set<string>();

  for (const pattern of patterns) {
    const matches = globSync(pattern, {
      cwd: projectRoot,
      ignore,
      absolute: true,
      nodir: true,
    });
    for (const match of matches) {
      files.add(path.resolve(match));
    }
  }

  if (files.size === 0) {
    logger.info('No files matched Prettier patterns.');
    return true;
  }

  let hasIssues = false;
  let formattedCount = 0;

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (error) {
      logger.warn(`Unable to read ${file}:`, error);
      hasIssues = true;
      continue;
    }

    const config = await loadConfigForFile(prettier, file, configPath ?? sharedConfigPath, fallbackConfig);
    const finalConfig = { ...config, filepath: file } as Record<string, unknown>;

    try {
      if (options.write) {
        const formatted = await Promise.resolve(prettier.format(content, finalConfig));
        if (formatted !== content) {
          fs.writeFileSync(file, formatted, 'utf8');
          formattedCount += 1;
          logger.debug(`Formatted ${path.relative(projectRoot, file)}`);
        }
      } else {
        const isFormatted = await Promise.resolve(prettier.check(content, finalConfig));
        if (!isFormatted) {
          hasIssues = true;
          logger.warn(`Formatting required: ${path.relative(projectRoot, file)}`);
        }
      }
    } catch (error) {
      hasIssues = true;
      logger.error(`Prettier failed for ${path.relative(projectRoot, file)}:`, error);
    }
  }

  if (options.write) {
    if (hasIssues) {
      logger.error('Prettier encountered errors while formatting.');
      return false;
    }
    logger.success(`Prettier formatting complete. Updated ${formattedCount} file(s).`);
    return true;
  }

  if (hasIssues) {
    logger.error('Prettier check failed. Run with --write to fix formatting.');
    return false;
  }

  logger.success('Prettier check passed.');
  return true;
}

if (require.main === module) {
  const program = new Command();

  program
    .description('Run Prettier using shared defaults with project overrides.')
    .option('--write', 'Write formatting changes instead of checking.')
    .option('--config <path>', 'Path to a Prettier configuration file.')
    .option('--pattern <glob>', 'Glob pattern to include (can be repeated).', (value, previous: string[]) => {
      if (previous) {
        return [...previous, value];
      }
      return [value];
    })
    .option('--ignore <glob>', 'Glob pattern to ignore (can be repeated).', (value, previous: string[]) => {
      if (previous) {
        return [...previous, value];
      }
      return [value];
    })
    .parse(process.argv);

  const opts = program.opts();
  const patterns = opts.pattern as string[] | undefined;
  const ignore = opts.ignore as string[] | undefined;

  runPrettier({
    write: Boolean(opts.write),
    config: opts.config,
    patterns,
    ignore,
  }).then(success => {
    process.exit(success ? 0 : 1);
  });
}
