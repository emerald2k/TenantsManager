import { beforeEach, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  backfillPaymentReminderDaysBefore,
  DEFAULT_PAYMENT_REMINDER_DAYS_BEFORE,
} from '../scripts/backfillPaymentReminderDaysBefore.js'

// Functions tests — the REAL boundary (Firestore emulator). Tests the
// exported `backfillPaymentReminderDaysBefore(db, {apply})` directly, not
// the script's CLI `main()` — same split `dailyScheduler.test.js` uses
// between `dailySchedulerHandler` and the `onSchedule` wrapper around it.
//
// Unlike `scheduler.js` (a `src/` module, self-initializing at import time),
// `scripts/backfillPaymentReminderDaysBefore.js` only calls `initializeApp`
// inside its own CLI `main()`, deliberately — importing it for a test must
// not also run `main()`'s project-id assertion. This file initializes the
// (bare, ambient-emulator) app itself instead, same call `scheduler.js`
// makes at its own top level.
if (!getApps().length) {
  initializeApp()
}

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

function tenancyWithout(field, overrides = {}) {
  const base = {
    userId: 'user-1',
    status: 'active',
    dueDay: 12,
    reportReminderDaysBefore: 3,
    paymentReminderDaysBefore: 5,
    currentBalance: 0,
    ...overrides,
  }
  delete base[field]
  return base
}

beforeEach(async () => {
  await clearEmulators()
})

describe('backfillPaymentReminderDaysBefore (CLAUDE.md §10, FR-PAY-10, SRS §9)', () => {
  it('dry run (default): reports what WOULD be backfilled, writes nothing', async () => {
    await db
      .collection('tenancies')
      .doc('pre-m8')
      .set(tenancyWithout('paymentReminderDaysBefore'))

    const result = await backfillPaymentReminderDaysBefore(db)

    expect(result.backfilled).toEqual(['pre-m8'])
    const after = await db.collection('tenancies').doc('pre-m8').get()
    expect(after.data().paymentReminderDaysBefore).toBeUndefined()
  })

  it('--apply writes the SRS-documented default (3) onto a tenancy missing the field', async () => {
    await db
      .collection('tenancies')
      .doc('pre-m8')
      .set(tenancyWithout('paymentReminderDaysBefore'))

    await backfillPaymentReminderDaysBefore(db, { apply: true })

    const after = await db.collection('tenancies').doc('pre-m8').get()
    expect(after.data().paymentReminderDaysBefore).toBe(
      DEFAULT_PAYMENT_REMINDER_DAYS_BEFORE,
    )
    expect(DEFAULT_PAYMENT_REMINDER_DAYS_BEFORE).toBe(3)
  })

  it('never overwrites a tenancy that already has the field — additive only, whatever its value', async () => {
    await db
      .collection('tenancies')
      .doc('post-m8')
      .set(tenancyWithout('__none__', { paymentReminderDaysBefore: 7 }))

    const result = await backfillPaymentReminderDaysBefore(db, {
      apply: true,
    })

    expect(result.backfilled).toEqual([])
    const after = await db.collection('tenancies').doc('post-m8').get()
    expect(after.data().paymentReminderDaysBefore).toBe(7) // untouched
  })

  it('rewrites nothing else on the document — additive, per CLAUDE.md §10', async () => {
    await db
      .collection('tenancies')
      .doc('pre-m8')
      .set(tenancyWithout('paymentReminderDaysBefore', { dueDay: 20 }))

    await backfillPaymentReminderDaysBefore(db, { apply: true })

    const after = await db.collection('tenancies').doc('pre-m8').get()
    expect(after.data().dueDay).toBe(20)
    expect(after.data().reportReminderDaysBefore).toBe(3)
  })

  it('idempotent: a second run after a successful apply finds nothing left to do', async () => {
    await db
      .collection('tenancies')
      .doc('pre-m8')
      .set(tenancyWithout('paymentReminderDaysBefore'))

    await backfillPaymentReminderDaysBefore(db, { apply: true })
    const second = await backfillPaymentReminderDaysBefore(db, {
      apply: true,
    })

    expect(second.backfilled).toEqual([])
    expect(second.alreadySet).toBe(1)
  })

  it('handles a mix — some tenancies backfilled, others left alone', async () => {
    await db
      .collection('tenancies')
      .doc('pre-m8-a')
      .set(tenancyWithout('paymentReminderDaysBefore'))
    await db
      .collection('tenancies')
      .doc('pre-m8-b')
      .set(tenancyWithout('paymentReminderDaysBefore'))
    await db
      .collection('tenancies')
      .doc('post-m8')
      .set(tenancyWithout('__none__', { paymentReminderDaysBefore: 10 }))

    const result = await backfillPaymentReminderDaysBefore(db, {
      apply: true,
    })

    expect(result.total).toBe(3)
    expect(result.backfilled.sort()).toEqual(['pre-m8-a', 'pre-m8-b'])
    expect(result.alreadySet).toBe(1)
    const untouched = await db.collection('tenancies').doc('post-m8').get()
    expect(untouched.data().paymentReminderDaysBefore).toBe(10)
  })

  it('an empty tenancies collection backfills nothing, crashes nothing', async () => {
    const result = await backfillPaymentReminderDaysBefore(db, {
      apply: true,
    })

    expect(result.total).toBe(0)
    expect(result.backfilled).toEqual([])
  })
})
