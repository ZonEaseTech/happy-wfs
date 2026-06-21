/**
 * Commitlint configuration.
 *
 * Extends the Conventional Commits preset, with two relaxations to fit this
 * repo's existing history:
 *   - `release` is added to the allowed commit types (used for release commits).
 *   - Scope is not enforced (any scope, or none, is accepted).
 */
module.exports = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [
            2,
            'always',
            [
                'feat',
                'fix',
                'docs',
                'style',
                'refactor',
                'perf',
                'test',
                'build',
                'ci',
                'chore',
                'revert',
                'release',
            ],
        ],
    },
};
