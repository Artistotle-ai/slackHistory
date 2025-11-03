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
  // Coverage thresholds (can be adjusted as coverage improves)
  // coverageThreshold: {
  //   global: {
  //     branches: 70,
  //     functions: 70,
  //     lines: 70,
  //     statements: 70,
  //   },
  // },
  // Setup for handling module paths correctly
  moduleDirectories: ['node_modules', '<rootDir>'],
  // Prevent duplicate runs if running from individual function directories
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
  ],
};

