import { beforeEach, describe, expect, it } from 'vitest'
import { getFirestore } from 'firebase-admin/firestore'
import {
  onMailWriteHandler,
  REDACTED_PLACEHOLDER,
} from '../src/notifications.js'

// Functions tests — the REAL boundary (Firestore emulator), no mocks of the
// data layer. Started via `npm run test:emulator` (firebase emulators:exec).
// Mirrors onPropertyUpdate.test.js's structure/conventions: the handler is
// called directly with a hand-built event, since `test:emulator` starts
// Auth/Firestore only, not the Functions emulator — no test here exercises
// the REAL deployed trigger chain (onMailWrite re-triggering itself after
// the redaction write is therefore reasoned about, not observed live; see
// each test's own comment for how it still proves the guard is real).

const PROJECT_ID = 'tenants-manager-2026'
const db = getFirestore()

function mail(overrides = {}) {
  return {
    to: ['tenant@example.com'],
    message: { subject: 'Subiect', text: 'Corp' },
    type: 'arrears-reminder',
    audience: 'tenant',
    relatedId: 'tenancy-1',
    ownerId: 'admin-uid',
    delivery: { state: 'PENDING', error: null },
    ...overrides,
  }
}

async function clearEmulators() {
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(
    `http://${fsHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  )
}

async function seedMail(id, overrides = {}) {
  await db.collection('mail').doc(id).set(mail(overrides))
}

function fakeEvent({ mailId, afterData }) {
  return {
    params: { mailId },
    data: {
      after: afterData
        ? { exists: true, data: () => afterData }
        : { exists: false },
    },
  }
}

beforeEach(async () => {
  await clearEmulators()
})

describe('onMailWriteHandler — projection (FR-NLOG-01/03/04/05)', () => {
  it('projects type/audience/subject/to/deliveryState/relatedId/ownerId onto notifications/{mailId}', async () => {
    const data = mail({ type: 'report-new', audience: 'tenant' })
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const snap = await db.collection('notifications').doc('mail-1').get()
    expect(snap.exists).toBe(true)
    expect(snap.data()).toMatchObject({
      mailId: 'mail-1',
      type: 'report-new',
      audience: 'tenant',
      subject: data.message.subject,
      to: data.to,
      deliveryState: 'PENDING',
      deliveryError: null,
      relatedId: 'tenancy-1',
      ownerId: 'admin-uid',
    })
    expect(snap.data().sentAt).toBeTruthy()
  })

  it('never projects message.text — bodies are metadata-free (FR-NLOG-02)', async () => {
    const data = mail()
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const snap = await db.collection('notifications').doc('mail-1').get()
    expect(snap.data().text).toBeUndefined()
    expect(Object.keys(snap.data())).not.toContain('text')
  })

  it('converges three fires (PENDING → PROCESSING → SUCCESS) on ONE row, sentAt stamped only once', async () => {
    const pending = mail({ delivery: { state: 'PENDING', error: null } })
    await seedMail('mail-1', pending)
    await onMailWriteHandler(
      fakeEvent({ mailId: 'mail-1', afterData: pending }),
    )
    const afterFirst = await db.collection('notifications').doc('mail-1').get()
    const sentAtFirst = afterFirst.data().sentAt

    const processing = mail({ delivery: { state: 'PROCESSING', error: null } })
    await onMailWriteHandler(
      fakeEvent({ mailId: 'mail-1', afterData: processing }),
    )
    const success = mail({ delivery: { state: 'SUCCESS', error: null } })
    await onMailWriteHandler(
      fakeEvent({ mailId: 'mail-1', afterData: success }),
    )

    const all = await db.collection('notifications').get()
    expect(all.size).toBe(1)

    const finalSnap = await db.collection('notifications').doc('mail-1').get()
    expect(finalSnap.data().deliveryState).toBe('SUCCESS')
    expect(finalSnap.data().sentAt.isEqual(sentAtFirst)).toBe(true)
  })

  // Mutation check (CLAUDE.md §7): temporarily changing the `!existing.exists`
  // guard in `projectNotification` to always stamp `sentAt` made this test
  // fail (`sentAtFirst` differed from the final `sentAt`), confirmed, then
  // reverted — see the stage report.
})

describe('onMailWriteHandler — post-delivery redaction (FR-NLOG-09)', () => {
  it('empties message.text and sets redacted:true on a delivered A1 credentials email (redactAfterDelivery flag)', async () => {
    const data = mail({
      type: 'credentials',
      audience: 'tenant',
      message: { subject: 'Contul tău', text: 'Parolă: hunter2' },
      delivery: { state: 'SUCCESS', error: null },
      redactAfterDelivery: true,
    })
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const snap = await db.collection('mail').doc('mail-1').get()
    expect(snap.data().message.text).toBe(REDACTED_PLACEHOLDER)
    expect(snap.data().message.text).not.toContain('hunter2')
    expect(snap.data().redacted).toBe(true)
  })

  it('ALSO redacts a delivered A9 credentials-resent email — same flag, different type (the trigger never looks at type)', async () => {
    const data = mail({
      type: 'credentials-resent',
      message: { subject: 'Datele tale', text: 'Parolă: hunter2' },
      delivery: { state: 'SUCCESS', error: null },
      redactAfterDelivery: true,
    })
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const snap = await db.collection('mail').doc('mail-1').get()
    expect(snap.data().message.text).toBe(REDACTED_PLACEHOLDER)
    expect(snap.data().message.text).not.toContain('hunter2')
    expect(snap.data().redacted).toBe(true)
  })

  // Anti-vacuity for the flag guard (CLAUDE.md §7): a delivered email that did
  // NOT self-mark is left untouched. Mutation check: replacing
  // `if (mail.redactAfterDelivery !== true) return` with `if (false) return`
  // made this test fail (a normal arrears reminder got its body emptied),
  // confirmed, then reverted.
  it('does NOT redact a delivered email that carries no redactAfterDelivery flag', async () => {
    const data = mail({
      type: 'arrears-reminder',
      message: { subject: 'Plată restantă', text: 'Ai o plată restantă.' },
      delivery: { state: 'SUCCESS', error: null },
    })
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const snap = await db.collection('mail').doc('mail-1').get()
    expect(snap.data().message.text).toBe('Ai o plată restantă.')
    expect(snap.data().redacted).toBeUndefined()
  })

  it('does NOT redact a flagged email before delivery (PENDING/PROCESSING)', async () => {
    const data = mail({
      type: 'credentials',
      message: { subject: 'Contul tău', text: 'Parolă: hunter2' },
      delivery: { state: 'PROCESSING', error: null },
      redactAfterDelivery: true,
    })
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const snap = await db.collection('mail').doc('mail-1').get()
    expect(snap.data().message.text).toBe('Parolă: hunter2')
    expect(snap.data().redacted).toBeUndefined()
  })

  // LOOP GUARD (trap #1, FR-NLOG-09): a real deployed trigger fires AGAIN
  // after the redaction write above, seeing `redacted: true` already set.
  // The handler is called directly (see file header), so that re-fire is
  // simulated: seed a document ALREADY `redacted: true` but whose text was
  // deliberately left as the ORIGINAL string — a state that never occurs in
  // practice, but which sharply exercises the guard: the handler must stop
  // on the `redacted` sentinel and must NOT re-empty this text.
  it('skips an already-redacted document — the loop guard, proven by re-invoking the handler', async () => {
    const data = mail({
      type: 'credentials',
      message: {
        subject: 'Contul tău',
        text: 'ORIGINAL — should not be touched',
      },
      delivery: { state: 'SUCCESS', error: null },
      redactAfterDelivery: true,
      redacted: true,
    })
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const snap = await db.collection('mail').doc('mail-1').get()
    expect(snap.data().message.text).toBe('ORIGINAL — should not be touched')
  })

  it('idempotent under repeated SUCCESS fires — redacting twice does not error or change the placeholder', async () => {
    const data = mail({
      type: 'credentials',
      message: { subject: 'Contul tău', text: 'Parolă: hunter2' },
      delivery: { state: 'SUCCESS', error: null },
      redactAfterDelivery: true,
    })
    await seedMail('mail-1', data)
    await onMailWriteHandler(fakeEvent({ mailId: 'mail-1', afterData: data }))

    const redacted = await db.collection('mail').doc('mail-1').get()
    // Second fire, as the extension might re-deliver the same SUCCESS state
    // (§6's at-least-once note) — this time with the ALREADY-redacted data,
    // exactly what the real trigger would receive on its second invocation.
    await onMailWriteHandler(
      fakeEvent({ mailId: 'mail-1', afterData: redacted.data() }),
    )

    const finalSnap = await db.collection('mail').doc('mail-1').get()
    expect(finalSnap.data().message.text).toBe(REDACTED_PLACEHOLDER)
    expect(finalSnap.data().redacted).toBe(true)
  })
})
