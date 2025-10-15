import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { configLoader } from '../../lib/config-loader';
import { cleanDeployments } from '../../lib/deployments/cleaner';
import { collectContractAddresses } from '../../lib/deployments/contracts-report';
import { generateOracleReport } from '../../lib/deployments/oracle-report';
import { generateNSLOCReport } from '../../lib/deployments/nsloc';
import { loadProjectModule, getSolidityFiles } from '../../lib/utils';
import { validateConfig } from '../../lib/validators';

type TestCase = {
  name: string;
  fn: () => void | Promise<void>;
};

const tests: TestCase[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

function logError(message: string) {
  process.stderr.write(`${message}\n`);
}

test('configLoader falls back to shared defaults when project override is missing', () => {
  const slitherConfig = configLoader.loadConfig('slither');
  assert.ok(slitherConfig, 'slither.json should be returned when no project config exists');
  assert.equal(
    slitherConfig.json,
    'reports/slither-report.json',
    'shared slither config should expose expected report path'
  );
});

test('validateConfig surfaces missing required keys and type mismatches', () => {
  const schema = {
    name: { required: true, type: 'string' },
    threshold: { required: false, type: 'number' }
  } as const;

  const missing = validateConfig({}, schema);
  assert.equal(missing.valid, false, 'missing required key should mark config invalid');
  assert.ok(
    missing.errors.some(error => error.includes('Missing required configuration: name')),
    'missing key should be reported in errors'
  );

  const wrongType = validateConfig({ name: 'ok', threshold: '1' }, schema);
  assert.equal(wrongType.valid, false, 'type mismatch should mark config invalid');
  assert.ok(
    wrongType.errors.some(error =>
      error.includes("Configuration 'threshold' has wrong type. Expected number, got string")
    ),
    'type mismatch should be reported'
  );
});

test('getSolidityFiles discovers Solidity sources recursively', () => {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp-solidity-fixtures-'));
  const contractsRoot = path.join(tempRoot, 'contracts');
  const nestedDir = path.join(contractsRoot, 'nested');
  fs.mkdirSync(nestedDir, { recursive: true });

  const tokenPath = path.join(contractsRoot, 'Token.sol');
  const vaultPath = path.join(nestedDir, 'Vault.sol');
  fs.writeFileSync(tokenPath, 'contract Token { }\n');
  fs.writeFileSync(vaultPath, 'contract Vault { }\n');

  try {
    const relativeContractsRoot = path.relative(process.cwd(), tempRoot) || tempRoot;
    const files = getSolidityFiles(relativeContractsRoot);
    assert.equal(files.length, 2, 'two Solidity files should be discovered');
    assert.ok(files.some(filePath => filePath.endsWith('Token.sol')));
    assert.ok(files.some(filePath => filePath.endsWith('Vault.sol')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('loadProjectModule resolves modules relative to the project root', () => {
  const typescriptModule = loadProjectModule('typescript');
  assert.ok(typescriptModule, 'typescript should resolve from package dependencies');

  const missingModule = loadProjectModule('this-module-should-not-exist');
  assert.equal(missingModule, null, 'missing module should resolve to null');
});

test('cleanDeployments removes matching artifacts and updates migrations', () => {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp-deployments-'));
  const projectDir = path.join(tempRoot, 'project');
  const deploymentsDir = path.join(projectDir, 'deployments', 'testnet');
  fs.mkdirSync(deploymentsDir, { recursive: true });

  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'temp-project' }));

  const migrationsPath = path.join(deploymentsDir, '.migrations.json');
  fs.writeFileSync(
    migrationsPath,
    JSON.stringify({
      AlphaContract: { address: '0xabc' },
      BetaContract: { address: '0xdef' },
    })
  );

  const alphaPath = path.join(deploymentsDir, 'AlphaContract.json');
  const betaPath = path.join(deploymentsDir, 'BetaContract.json');
  fs.writeFileSync(alphaPath, JSON.stringify({ address: '0xabc' }));
  fs.writeFileSync(betaPath, JSON.stringify({ address: '0xdef' }));

  const originalCwd = process.cwd();
  process.chdir(projectDir);
  try {
    const result = cleanDeployments({
      network: 'testnet',
      keywords: ['Alpha'],
    });

    assert.deepEqual(result.removedMigrationKeys, ['AlphaContract']);
    assert.ok(!fs.existsSync(alphaPath), 'Alpha deployment should be removed');
    assert.ok(fs.existsSync(betaPath), 'Beta deployment should remain');

    const updatedMigrations = JSON.parse(fs.readFileSync(migrationsPath, 'utf8')) as Record<string, unknown>;
    assert.ok(!('AlphaContract' in updatedMigrations), 'Removed key should not exist in migrations');
    assert.ok('BetaContract' in updatedMigrations, 'Unmatched key should remain');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('collectContractAddresses gathers addresses from deployment files', () => {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp-contract-addresses-'));
  const projectDir = path.join(tempRoot, 'project');
  const deploymentsDir = path.join(projectDir, 'deployments', 'mainnet');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'temp-project' }));

  fs.writeFileSync(path.join(deploymentsDir, '.migrations.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(deploymentsDir, 'Token.json'), JSON.stringify({ address: '0x123' }));
  fs.writeFileSync(path.join(deploymentsDir, 'Vault.json'), JSON.stringify({}));

  const originalCwd = process.cwd();
  process.chdir(projectDir);
  try {
    const report = collectContractAddresses({ network: 'mainnet', includeEmpty: true });
    assert.equal(report.rows.length, 2, 'Both deployments should be included when includeEmpty is true');
    const tokenRow = report.rows.find(row => row.file === 'Token.json');
    assert.equal(tokenRow?.address, '0x123');
    const vaultRow = report.rows.find(row => row.file === 'Vault.json');
    assert.equal(vaultRow?.address, null);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generateOracleReport categorizes addresses using custom patterns', () => {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp-oracle-report-'));
  const projectDir = path.join(tempRoot, 'project');
  const deploymentsDir = path.join(projectDir, 'deployments', 'stage');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'temp-project' }));

  fs.writeFileSync(path.join(deploymentsDir, '.migrations.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(deploymentsDir, 'RedstoneOracle.json'), JSON.stringify({ address: '0xaaa' }));
  fs.writeFileSync(path.join(deploymentsDir, 'ChainlinkFeed.json'), JSON.stringify({ address: '0xbbb' }));
  fs.writeFileSync(path.join(deploymentsDir, 'MockOracle.json'), JSON.stringify({ address: '0xccc' }));

  const originalCwd = process.cwd();
  process.chdir(projectDir);
  try {
    const report = generateOracleReport({
      networks: ['stage'],
      categories: [
        { name: 'Redstone', include: ['Redstone'] },
        { name: 'Chainlink', include: ['Chainlink'], exclude: ['Mock'] },
      ],
    });

    const stage = report.stage;
    assert.ok(stage, 'Report should include the stage network');
    assert.deepEqual(stage.categories.Redstone, ['0xaaa']);
    assert.deepEqual(stage.categories.Chainlink, ['0xbbb']);
    assert.deepEqual(stage.uncategorized, ['0xccc']);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generateNSLOCReport produces metrics for Solidity sources', () => {
  const tempRoot = fs.mkdtempSync(path.join(process.cwd(), 'tmp-nsloc-report-'));
  const projectDir = path.join(tempRoot, 'project');
  const contractsDir = path.join(projectDir, 'contracts');
  fs.mkdirSync(contractsDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'temp-project' }));

  const contractPath = path.join(contractsDir, 'Example.sol');
  fs.writeFileSync(
    contractPath,
    'pragma solidity ^0.8.0; contract Example { function run() external pure returns (uint256) { return 1; } }\n'
  );

  const originalCwd = process.cwd();
  process.chdir(projectDir);
  try {
    const report = generateNSLOCReport();
    assert.equal(report.rows.length, 1, 'Single contract should produce one row');
    assert.ok(report.totalNSLOC > 0, 'nSLOC total should be greater than zero');
    assert.equal(report.errors.length, 0, 'No parsing errors expected for simple contract');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

(async () => {
  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      log(`✅ ${name}`);
    } catch (error) {
      failures += 1;
      logError(`❌ ${name}`);
      if (error instanceof Error) {
        logError(error.stack ?? error.message);
      } else {
        logError(String(error));
      }
    }
  }

  log('');
  if (failures > 0) {
    logError(`Tests failed: ${failures}/${tests.length}`);
    process.exitCode = 1;
  } else {
    log(`All tests passed (${tests.length})`);
  }
})();
