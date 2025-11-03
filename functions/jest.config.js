const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^mnemosyne-slack-shared$': path.resolve(__dirname, 'slack-shared/src/index.ts'),
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        types: ['jest', 'node'],
      },
      isolatedModules: false,
    }],
  },
  collectCoverageFrom: [
    '**/src/**/*.ts',
    '!**/src/**/*.test.ts',
    '!**/src/**/__tests__/**',
    '!**/src/**/*.d.ts',
    '!**/dist/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  // Coverage thresholds - 90% target
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  // Setup for handling module paths correctly
  moduleDirectories: ['node_modules', '<rootDir>'],
  // Prevent duplicate runs if running from individual function directories
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
  ],
};

