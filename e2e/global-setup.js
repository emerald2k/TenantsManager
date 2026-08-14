import { spawnSync } from 'node:child_process'

// Invokes functions/scripts/seed.js directly (node, not `npm run seed`) -
// npm resolves to npm.cmd on Windows, which spawnSync can't launch without
// shell:true (verified; see plan finding #3). This duplicates the intent
// of functions/package.json's "seed" script rather than calling through
// it - same duplication discipline as the KYC schema (CLAUDE.md §7): if
// that script ever gains arguments, flags, or a pre/post hook, this call
// must be updated to match, or the two will silently drift apart.
export default function globalSetup() {
  const result = spawnSync('node', ['functions/scripts/seed.js'], {
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`Seeding failed with exit code ${result.status}`)
  }
}
