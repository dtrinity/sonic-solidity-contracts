module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  collectCoverageFrom: [
    'typescript/**/*.ts',
    'scripts/**/*.ts',
    '!typescript/**/*.spec.ts',
    '!typescript/**/*.test.ts',
    '!scripts/deploy_*.ts',
    '!scripts/verify.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 30000,
  maxWorkers: 1, // For Hardhat compatibility
  globalSetup: '<rootDir>/test/globalSetup.ts',
  globalTeardown: '<rootDir>/test/globalTeardown.ts',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/deployments/',
    '/artifacts/',
    '/cache/',
    '/typechain-types/'
  ],
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/typescript/$1',
    '^@contracts/(.*)$': '<rootDir>/contracts/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
    '^@test/(.*)$': '<rootDir>/test/$1'
  },
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  }
};
