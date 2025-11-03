const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^mnemosyne-slack-shared$': path.resolve(__dirname, '../slack-shared/src/index.ts'),
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@aws-sdk/client-lambda$': '<rootDir>/src/__tests__/__mocks__/@aws-sdk/client-lambda.ts',
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
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/__tests__/**',
  ],
};

