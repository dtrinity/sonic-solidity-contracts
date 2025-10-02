import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';
import { execCommand, isCommandAvailable } from './utils';

interface InstallAttempt {
  label: string;
  command: string;
  args: string[];
  notes?: string;
}

function augmentPathHints(): void {
  const existing = new Set((process.env.PATH || '').split(path.delimiter));
  const hints = new Set<string>();

  const userBase = process.env.PYTHONUSERBASE;
  if (userBase) {
    hints.add(path.join(userBase, 'bin'));
  }

  hints.add(path.join(os.homedir(), '.local', 'bin'));
  hints.add(path.join(os.homedir(), '.poetry', 'bin'));
  hints.add('/usr/local/bin');

  const libraryPythonDir = path.join(os.homedir(), 'Library', 'Python');
  if (fs.existsSync(libraryPythonDir)) {
    for (const entry of fs.readdirSync(libraryPythonDir)) {
      if (!/^\d+\.\d+$/.test(entry)) {
        continue;
      }
      hints.add(path.join(libraryPythonDir, entry, 'bin'));
    }
  }

  for (const hint of hints) {
    if (!hint || existing.has(hint) || !fs.existsSync(hint)) {
      continue;
    }

    process.env.PATH = `${hint}${path.delimiter}${process.env.PATH}`;
    existing.add(hint);
  }
}

export function ensureSlitherInstalled(options: { autoInstall?: boolean } = {}): boolean {
  augmentPathHints();

  if (isCommandAvailable('slither')) {
    return true;
  }

  if (options.autoInstall === false) {
    logger.error('Slither is not installed and auto-install is disabled.');
    return false;
  }

  return installSlither();
}

export function installSlither(): boolean {
  augmentPathHints();

  if (isCommandAvailable('slither')) {
    logger.info('Slither is already installed.');
    return true;
  }

  const attempts: InstallAttempt[] = [
    {
      label: 'pipx',
      command: 'pipx',
      args: ['install', 'slither-analyzer'],
      notes: 'pipx keeps Python tooling isolated and adds shims to PATH.'
    },
    {
      label: 'pip3 --user',
      command: 'pip3',
      args: ['install', '--user', 'slither-analyzer'],
      notes: 'Install to Python user base (ensure ~/.local/bin is on PATH).'
    },
    {
      label: 'pip --user',
      command: 'pip',
      args: ['install', '--user', 'slither-analyzer'],
      notes: 'Fallback to pip --user if pip3 is unavailable.'
    }
  ];

  for (const attempt of attempts) {
    if (!isCommandAvailable(attempt.command)) {
      logger.debug(`Skipping ${attempt.label} install attempt (command not found).`);
      continue;
    }

    logger.info(`Attempting Slither installation via ${attempt.label}...`);
    if (attempt.notes) {
      logger.debug(attempt.notes);
    }

    const command = `${attempt.command} ${attempt.args.join(' ')}`;
    const result = execCommand(command, { stdio: 'inherit' });

    if (!result.success) {
      logger.warn(`Installation via ${attempt.label} failed.`, result.error);
      continue;
    }

    augmentPathHints();
    if (isCommandAvailable('slither')) {
      logger.success('Slither installation completed successfully.');
      return true;
    }

    logger.warn(`Installation via ${attempt.label} finished but 'slither' is still not on PATH.`);
  }

  logger.error('Unable to install Slither automatically.');
  logger.info(
    'Install Slither manually with one of the following commands and ensure the binary is on your PATH:\n' +
      '  pipx install slither-analyzer\n' +
      '  pip3 install --user slither-analyzer\n' +
      '  pip install --user slither-analyzer'
  );
  logger.info('If you used pip --user, add ~/.local/bin to your PATH or re-run the command using pipx.');
  return false;
}
