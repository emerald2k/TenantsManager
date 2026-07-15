/**
 * Impune convenția Conventional Commits (CLAUDE.md §5):
 *   <tip>: <descriere la imperativ, cu literă mică>
 * Tipuri permise: feat, fix, docs, chore, test, refactor, style, build, ci.
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
