import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkAdminEmailConfiguredCore,
  checkAdminEmailConfiguredHandler,
} from '../src/checkAdminEmailConfigured.js'

// Functions tests — no Firestore/Storage/Auth involved at all (a pure env
// read), so this needs no emulator seeding. Still lives in the functions
// band since it is a Cloud Function.

let ambientAdminEmail
beforeEach(() => {
  ambientAdminEmail = process.env.ADMIN_EMAIL
})

afterEach(() => {
  if (ambientAdminEmail === undefined) {
    delete process.env.ADMIN_EMAIL
  } else {
    process.env.ADMIN_EMAIL = ambientAdminEmail
  }
})

describe('checkAdminEmailConfiguredCore (FR-SYS-07)', () => {
  it('reports configured: true when ADMIN_EMAIL is set', () => {
    process.env.ADMIN_EMAIL = 'admin@example.com'

    expect(checkAdminEmailConfiguredCore()).toEqual({ configured: true })
  })

  it('reports configured: false when ADMIN_EMAIL is unset', () => {
    delete process.env.ADMIN_EMAIL

    expect(checkAdminEmailConfiguredCore()).toEqual({ configured: false })
  })

  it('reports configured: false for an empty string, not a truthy misread', () => {
    process.env.ADMIN_EMAIL = ''

    expect(checkAdminEmailConfiguredCore()).toEqual({ configured: false })
  })
})

describe('checkAdminEmailConfiguredHandler — admin guard', () => {
  it('rejects a non-admin caller', async () => {
    await expect(
      checkAdminEmailConfiguredHandler({ auth: { token: { admin: false } } }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects an unauthenticated caller', async () => {
    await expect(
      checkAdminEmailConfiguredHandler({ auth: null }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('returns the live config state for an admin caller', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com'

    await expect(
      checkAdminEmailConfiguredHandler({ auth: { token: { admin: true } } }),
    ).resolves.toEqual({ configured: true })
  })
})
