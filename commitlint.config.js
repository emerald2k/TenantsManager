/**
 * Enforces the Conventional Commits convention (CLAUDE.md §5):
 *   <type>: <imperative description, lowercase>
 * Allowed types: feat, fix, docs, chore, test, refactor, style, build, ci.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'chore',
        'test',
        'refactor',
        'style',
        'build',
        'ci',
      ],
    ],
  },
}
