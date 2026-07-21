import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import {
  resetTenantPasswordCore,
  resetTenantPasswordHandler,
} from '../src/resetTenantPassword.js'

// Functions tests — the REAL boundary (Auth emulator), no mocks of the data
// layer, same convention as kyc.test.js. Started via `npm run test:emulator`.

const PROJECT_ID = 'tenants-manager-2026'
const auth = getAuth()

async function clearEmulators() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
  await fetch(
    `http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: 'DELETE' },
  )
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await clearEmulators()
})

describe('resetTenantPassword — happy path (SRS §7.2)', () => {
  it('generates a 12+ char password and sets it on the Auth account via updateUser', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })
    const updateSpy = vi.spyOn(auth, 'updateUser')

    const result = await resetTenantPasswordCore(userRecord.uid, 'admin-uid')

    // FR-AUTH-06 / NFR-SEC-03: same 12+ minimum as finalizeKyc's generatePassword.
    expect(result.password).toBeTruthy()
    expect(result.password.length).toBeGreaterThanOrEqual(12)
    // The EXACT password returned to the admin is the one actually sent to
    // Auth — not a different, unrelated random string.
    expect(updateSpy).toHaveBeenCalledWith(userRecord.uid, {
      password: result.password,
    })
  })

  it('does NOT write anything to the mail collection (face-to-face handoff, unlike finalizeKyc)', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })
    const { getFirestore } = await import('firebase-admin/firestore')
    const db = getFirestore()
    await db
      .collection('mail')
      .get()
      .then((snap) => Promise.all(snap.docs.map((d) => d.ref.delete())))

    await resetTenantPasswordCore(userRecord.uid, 'admin-uid')

    const mailSnap = await db.collection('mail').get()
    expect(mailSnap.size).toBe(0)
  })
})

describe('resetTenantPassword — invalid states', () => {
  it('rejects a user that does not exist', async () => {
    await expect(
      resetTenantPasswordCore('does-not-exist', 'admin-uid'),
    ).rejects.toMatchObject({ code: 'not-found' })
  })
})

describe('resetTenantPassword — callable guard', () => {
  it('rejects a non-admin caller (callable guard)', async () => {
    const userRecord = await auth.createUser({
      email: 'ion@example.com',
      password: 'old-password-123',
    })

    await expect(
      resetTenantPasswordHandler({
        auth: { token: {}, uid: 'x' },
        data: { userId: userRecord.uid },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('rejects a missing userId argument', async () => {
    await expect(
      resetTenantPasswordHandler({
        auth: { token: { admin: true }, uid: 'admin-uid' },
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})
