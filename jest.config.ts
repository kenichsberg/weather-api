/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  __esModule: true,
  default: {
    testEnvironment: 'node',
    transform: {
      '\\.[jt]s?$': [
        'ts-jest',
        {
          'useESM': true
        }
      ]
    },
    moduleNameMapper: {
      '^\\./app.js$': '../src/app',
      '^\\./db.js$': '../src/db',
      '^\\./routes.js$': '../src/routes',
      '^\\./server.js$': '../src/server',
    },
    extensionsToTreatAsEsm: [
      ".ts"
    ],
    moduleFileExtensions: [
      'ts',
      'js',
    ],
    testMatch: [
      '**/tests/**/*.test.ts',
    ],
  },
}
