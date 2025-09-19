#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../lib/logger';

interface SetupOptions {
  hooks?: boolean;
  configs?: boolean;
  ci?: boolean;
  force?: boolean;
}

function setupGitHooks(force: boolean = false): void {
  logger.info('Setting up git hooks...');

  const hooksDir = path.join(__dirname, '..', 'hooks');
  const gitHooksDir = path.join(process.cwd(), '.git', 'hooks');

  if (!fs.existsSync(gitHooksDir)) {
    logger.error('Not in a git repository');
    return;
  }

  const hooks = ['pre-commit', 'pre-push'];

  for (const hook of hooks) {
    const sourcePath = path.join(hooksDir, hook);
    const targetPath = path.join(gitHooksDir, hook);

    if (!fs.existsSync(sourcePath)) {
      logger.warn(`Hook ${hook} not found in shared tools`);
      continue;
    }

    if (fs.existsSync(targetPath) && !force) {
      logger.warn(`Hook ${hook} already exists. Use --force to overwrite`);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    fs.chmodSync(targetPath, '755');
    logger.success(`Installed ${hook} hook`);
  }
}

function setupConfigs(force: boolean = false): void {
  logger.info('Setting up configurations...');

  const configsDir = path.join(__dirname, '..', 'configs');
  const projectRoot = process.cwd();

  const configs = [
    { name: 'slither.json', target: '.slither.json' },
    { name: 'solhint.json', target: '.solhint.json' }
  ];

  for (const config of configs) {
    const sourcePath = path.join(configsDir, config.name);
    const targetPath = path.join(projectRoot, config.target);

    if (!fs.existsSync(sourcePath)) {
      logger.warn(`Config ${config.name} not found in shared tools`);
      continue;
    }

    if (fs.existsSync(targetPath) && !force) {
      logger.warn(`Config ${config.target} already exists. Use --force to overwrite`);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    logger.success(`Created ${config.target}`);
  }
}

function setupCI(force: boolean = false): void {
  logger.info('Setting up CI workflows...');

  const ciDir = path.join(__dirname, '..', 'ci');
  const workflowsDir = path.join(process.cwd(), '.github', 'workflows');

  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  const workflows = ['shared-guardrails.yml'];

  for (const workflow of workflows) {
    const sourcePath = path.join(ciDir, workflow);
    const targetPath = path.join(workflowsDir, workflow);

    if (!fs.existsSync(sourcePath)) {
      logger.warn(`Workflow ${workflow} not found in shared tools`);
      continue;
    }

    if (fs.existsSync(targetPath) && !force) {
      logger.warn(`Workflow ${workflow} already exists. Use --force to overwrite`);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    logger.success(`Created workflow ${workflow}`);
  }
}

function updatePackageJson(): void {
  logger.info('Updating package.json scripts...');

  const packagePath = path.join(process.cwd(), 'package.json');

  if (!fs.existsSync(packagePath)) {
    logger.error('No package.json found');
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

  // Add helpful scripts
  const scriptsToAdd = {
    'analyze': 'ts-node .shared/scripts/analysis/run-all.ts',
    'analyze:slither': 'ts-node .shared/scripts/analysis/slither.ts',
    'analyze:mythril': 'ts-node .shared/scripts/analysis/mythril.ts',
    'analyze:solhint': 'ts-node .shared/scripts/analysis/solhint.ts',
    'shared:update': 'bash .shared/scripts/subtree/update.sh'
  };

  if (!packageJson.scripts) {
    packageJson.scripts = {};
  }

  let scriptsAdded = false;
  for (const [name, command] of Object.entries(scriptsToAdd)) {
    if (!packageJson.scripts[name]) {
      packageJson.scripts[name] = command;
      scriptsAdded = true;
      logger.success(`Added script: ${name}`);
    }
  }

  if (scriptsAdded) {
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
    logger.success('Updated package.json');
  } else {
    logger.info('All scripts already present in package.json');
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const options: SetupOptions = {};

  // Parse arguments
  for (const arg of args) {
    switch (arg) {
      case '--hooks':
        options.hooks = true;
        break;
      case '--configs':
        options.configs = true;
        break;
      case '--ci':
        options.ci = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--all':
        options.hooks = true;
        options.configs = true;
        options.ci = true;
        break;
    }
  }

  // If no specific options, setup everything
  if (!options.hooks && !options.configs && !options.ci) {
    options.hooks = true;
    options.configs = true;
    options.ci = true;
  }

  logger.info('Setting up shared hardhat tools...\n');

  if (options.hooks) {
    setupGitHooks(options.force);
  }

  if (options.configs) {
    setupConfigs(options.force);
  }

  if (options.ci) {
    setupCI(options.force);
  }

  updatePackageJson();

  logger.success('\nSetup complete!');
}