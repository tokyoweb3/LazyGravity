/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testPathIgnorePatterns: [
        '<rootDir>/tests/e2e.bot.test.ts',
        '<rootDir>/tests/services/responseMonitor.test.ts',
        '<rootDir>/tests/services/responseMonitor.stopButtonSelector.test.ts',
        '<rootDir>/tests/bot/refactorBaseline.test.ts',
    ],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};
