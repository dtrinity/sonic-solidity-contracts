import chalk from 'chalk';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  VERBOSE = 4
}

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string = 'shared-tools', level: LogLevel = LogLevel.INFO) {
    this.prefix = prefix;
    this.level = this.getLogLevelFromEnv() ?? level;
  }

  error(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(chalk.red(`[${this.prefix}] ERROR:`), message, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(chalk.yellow(`[${this.prefix}] WARN:`), message, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.INFO) {
      console.log(chalk.blue(`[${this.prefix}] INFO:`), message, ...args);
    }
  }

  success(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.INFO) {
      console.log(chalk.green(`[${this.prefix}] ✓`), message, ...args);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.log(chalk.gray(`[${this.prefix}] DEBUG:`), message, ...args);
    }
  }

  verbose(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.VERBOSE) {
      console.log(chalk.gray(`[${this.prefix}] VERBOSE:`), message, ...args);
    }
  }

  private getLogLevelFromEnv(): LogLevel | null {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LogLevel) {
      return LogLevel[envLevel as keyof typeof LogLevel] as LogLevel;
    }
    return null;
  }
}

export const logger = new Logger();