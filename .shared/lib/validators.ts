import * as fs from 'fs';
import * as path from 'path';
import { findProjectRoot } from './utils';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that required tools are installed
 */
export function validateTools(tools: string[]): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  for (const tool of tools) {
    try {
      require.resolve(tool);
    } catch {
      // Check if it's a system command
      const { execSync } = require('child_process');
      try {
        execSync(`which ${tool}`, { stdio: 'ignore' });
      } catch {
        result.valid = false;
        result.errors.push(`Required tool '${tool}' is not installed`);
      }
    }
  }

  return result;
}

/**
 * Validate Hardhat project structure
 */
export function validateHardhatProject(): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  const projectRoot = findProjectRoot();

  // Check for required files
  const requiredFiles = ['hardhat.config.ts', 'hardhat.config.js'];
  const hasHardhatConfig = requiredFiles.some(file =>
    fs.existsSync(path.join(projectRoot, file))
  );

  if (!hasHardhatConfig) {
    result.valid = false;
    result.errors.push('No Hardhat configuration file found');
  }

  // Check for package.json
  if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
    result.valid = false;
    result.errors.push('No package.json found in project root');
  }

  // Check for contracts directory
  if (!fs.existsSync(path.join(projectRoot, 'contracts'))) {
    result.warnings.push('No contracts directory found');
  }

  return result;
}

/**
 * Validate configuration object
 */
export function validateConfig(config: any, schema: any): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Simple validation - can be extended with a proper schema validator
  for (const key in schema) {
    if (schema[key].required && !(key in config)) {
      result.valid = false;
      result.errors.push(`Missing required configuration: ${key}`);
    }

    if (key in config && schema[key].type) {
      const actualType = typeof config[key];
      const expectedType = schema[key].type;
      if (actualType !== expectedType) {
        result.valid = false;
        result.errors.push(
          `Configuration '${key}' has wrong type. Expected ${expectedType}, got ${actualType}`
        );
      }
    }
  }

  return result;
}