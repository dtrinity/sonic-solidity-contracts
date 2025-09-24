import * as path from 'path';
import * as fs from 'fs';

export interface ConfigOptions {
  network?: string;
  configDir?: string;
  fallbackToShared?: boolean;
}

export class ConfigLoader {
  private sharedConfigDir: string;
  private projectRoot: string;

  constructor() {
    this.sharedConfigDir = path.join(__dirname, '..', 'configs');
    this.projectRoot = process.cwd();
  }

  /**
   * Load a configuration file with fallback to shared configs
   */
  loadConfig(configName: string, options: ConfigOptions = {}): any {
    const {
      network,
      configDir = '',
      fallbackToShared = true
    } = options;

    // Try network-specific config first
    if (network) {
      const networkConfig = this.tryLoadFile(
        path.join(this.projectRoot, configDir, `${configName}.${network}.json`)
      );
      if (networkConfig) return networkConfig;
    }

    // Try project-specific config
    const projectConfig = this.tryLoadFile(
      path.join(this.projectRoot, configDir, `${configName}.json`)
    );
    if (projectConfig) return projectConfig;

    // Fallback to shared config
    if (fallbackToShared) {
      const sharedConfig = this.tryLoadFile(
        path.join(this.sharedConfigDir, `${configName}.json`)
      );
      if (sharedConfig) return sharedConfig;
    }

    throw new Error(`Configuration file '${configName}' not found`);
  }

  /**
   * Merge project-specific config with shared config
   */
  mergeConfigs(configName: string, projectConfig: any = {}): any {
    const sharedConfig = this.tryLoadFile(
      path.join(this.sharedConfigDir, `${configName}.json`)
    );

    return {
      ...sharedConfig,
      ...projectConfig
    };
  }

  private tryLoadFile(filePath: string): any | null {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`Failed to load config from ${filePath}:`, error);
    }
    return null;
  }
}

export const configLoader = new ConfigLoader();