module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  globals: {
    'ts-jest': {
      useESM: false,
    },
  },
  transform: {
    '^.+\\\\.tsx?$': ['ts-jest', { useESM: false }],
  },
};
