const crypto = require('node:crypto')
const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { validateFullDraft } = require('./draftValidation')
const { buildCredentialsEmail } = require('./mail-templates/credentials')
const { buildAssignmentEmail } = require('./mail-templates/assignment')

/**
 * finalizeKyc (SRS §7.2, FR-TEN-07/16/18/22/23, FR-AUTH-06/07, FR-CON-02).
 *
 * Turns a completed onboarding draft into a real tenancy. BRANCHES on
 * `draft.existingUserId` (FR-TEN-07, Sub-stage E):
 *
 *  - ABSENT (brand-new tenant): validates the draft, checks the CNP is unique and
 *    the property is free, creates the Auth account, writes `users` + `tenancies`
 *    + the credentials email (A1), deletes the draft, returns the credentials to
 *    the admin for face-to-face handover.
 *  - SET (new tenancy on an EXISTING account): Steps 1-3 are irrelevant (the
 *    account already has that data) — no Auth account, no password. Verifies the
 *    linked account exists, the property is free, and the account has no OTHER
 *    active tenancy (FR-CON-02), then writes ONLY `tenancies` + a short
 *    assignment email (A7), deletes the draft.
 *
 * Both branches flip `properties/{propertyId}.status` to `'occupied'` in the same
 * transaction that creates the tenancy (FR-PROP-05) — finalizeKyc is the only
 * place M2 creates an active tenancy, so an inline write is enough; no separate
 * trigger exists (SRS §7.2 lists none). This is a DISPLAY signal only — the
 * authoritative occupancy gate for both branches stays the `status=='active'`
 * tenancy query inside the transaction, unaffected by this field's timeliness.
 */

if (!getApps().length) {
  initializeApp()
}

// The login URL that goes into the credentials/assignment email. Env-configurable
// so the same code serves the emulator and production; defaults to the local dev
// server.
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

// A clean charset — no 0/O/1/l/I — so the admin can read the password aloud without
// ambiguity at the desk. 12 characters: the FR-AUTH-06 / NFR-SEC-03 minimum ("12+"),
// still strong for a random password and shorter to read/dictate face-to-face.
const PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const PASSWORD_LENGTH = 12

function generatePassword() {
  let out = ''
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    out += PASSWORD_CHARSET[crypto.randomInt(PASSWORD_CHARSET.length)]
  }
  return out
}

/** The `users` document (SRS §6) — the KYC/profile fields from the draft, plus the
 * initial status. The contract fields and the draft's own system fields are left
 * out: contract data belongs to `tenancies`. Only ever used on the new-tenant
 * branch — the existing-user branch never touches `users`. */
function toUserDocument(draft) {
  const user = {
    name: draft.name,
    dateOfBirth: draft.dateOfBirth,
    email: draft.email,
    phone: draft.phone,
    preferredLanguage: draft.preferredLanguage,
    cnp: draft.cnp,
    idDocumentPhotos: draft.idDocumentPhotos ?? [],
    previousAddress: draft.previousAddress,
    emergencyContact: draft.emergencyContact,
    occupantCount: draft.occupantCount,
    smoker: draft.smoker,
    pets: draft.pets,
    vehicle: draft.vehicle,
    employer: draft.employer,
    occupation: draft.occupation,
    employmentDuration: draft.employmentDuration,
    monthlyIncome: draft.monthlyIncome,
    guarantor: draft.guarantor,
    previousReference: draft.previousReference,
    status: 'active',
  }
  // mailingAddress is optional (FR-TEN-06) — only store it when present.
  if (draft.mailingAddress?.trim()) {
    user.mailingAddress = draft.mailingAddress
  }
  return user
}

/**
 * The `tenancies` document (SRS §6) with the denormalizations: `property
 * {name, address}` from the property doc. `tenantName` is passed in EXPLICITLY,
 * not derived from `draft.name` here — on the existing-user branch `draft.name`
 * does not exist (Steps 1-3 are skipped), so the caller sources it from wherever
 * the tenant's name actually lives on that branch (`users/{existingUserId}.name`).
 */
function toTenancyDocument(draft, { userId, ownerId, tenantName, property }) {
  const tenancy = {
    userId,
    ownerId,
    propertyId: draft.propertyId,
    tenantName,
    property: { name: property.name, address: property.address },
    startDate: draft.startDate,
    endDate: draft.endDate,
    monthlyRent: draft.monthlyRent,
    dueDay: draft.dueDay,
    reportReminderDaysBefore: draft.reportReminderDaysBefore,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
  }
  // securityDeposit is optional (FR-CON-01). A NUMBER now (Sub-stage E, type
  // correction) — `typeof === 'number'` replaces the old `?.trim()` string check,
  // which would throw calling `.trim()` on a number.
  if (typeof draft.securityDeposit === 'number') {
    tenancy.securityDeposit = draft.securityDeposit
  }
  return tenancy
}

/**
 * Existing-user branch (FR-TEN-07): no Auth account, no CNP check (the draft
 * carries no `cnp` at all on this branch — Steps 1-3 are absent), no compensation
 * needed (nothing is created before the transaction).
 */
async function finalizeExistingUserTenancy(db, draft, draftRef, adminUid) {
  const tenancyRef = db.collection('tenancies').doc()
  const mailRef = db.collection('mail').doc()
  const userRef = db.collection('users').doc(draft.existingUserId)
  const propertyRef = db.collection('properties').doc(draft.propertyId)

  await db.runTransaction(async (tx) => {
    // ALL READS FIRST — the Admin SDK forbids a read after a write in a transaction.
    const activeTenancyOnPropertyQuery = db
      .collection('tenancies')
      .where('propertyId', '==', draft.propertyId)
      .where('status', '==', 'active')
      .limit(1)
    const activeTenancyOnUserQuery = db
      .collection('tenancies')
      .where('userId', '==', draft.existingUserId)
      .where('status', '==', 'active')
      .limit(1)

    const [userSnap, propertySnap, propertyActiveSnap, userActiveSnap] =
      await Promise.all([
        tx.get(userRef),
        tx.get(propertyRef),
        tx.get(activeTenancyOnPropertyQuery),
        tx.get(activeTenancyOnUserQuery),
      ])

    // Defensive: the draft's existingUserId should always point at a real account.
    if (!userSnap.exists) {
      throw new HttpsError(
        'not-found',
        'The linked tenant account does not exist.',
      )
    }
    if (!propertySnap.exists) {
      throw new HttpsError('not-found', 'The selected property does not exist.')
    }
    if (!propertyActiveSnap.empty) {
      throw new HttpsError(
        'failed-precondition',
        'The property is occupied; end the current tenancy first.',
        { reason: 'property-occupied' },
      )
    }
    // FR-CON-02: one account, at most one active tenancy at a time.
    if (!userActiveSnap.empty) {
      throw new HttpsError(
        'failed-precondition',
        'This account already has an active tenancy; end it first.',
        { reason: 'active-tenancy' },
      )
    }

    const user = userSnap.data()
    const property = propertySnap.data()

    tx.set(
      tenancyRef,
      toTenancyDocument(draft, {
        userId: draft.existingUserId,
        ownerId: adminUid,
        tenantName: user.name,
        property,
      }),
    )
    tx.set(
      mailRef,
      buildAssignmentEmail(user.preferredLanguage, {
        name: user.name,
        email: user.email,
        property: property.name,
        url: APP_URL,
      }),
    )
    tx.update(propertyRef, { status: 'occupied' })
    tx.delete(draftRef)
  })

  return {
    tenancyId: tenancyRef.id,
    userId: draft.existingUserId,
    accountCreated: false,
  }
}

/**
 * New-tenant branch — unchanged behavior from Sub-stage B, plus `accountCreated:
 * true` in the response and the `properties.status = 'occupied'` write (FR-PROP-05,
 * new in Sub-stage E — see the file header).
 */
async function finalizeNewTenant(db, auth, draft, draftRef, adminUid) {
  // 2. PRE-CHECK CNP (fail-fast, before Auth) — FR-TEN-22 ────────────────────────
  const cnpConflict = await db
    .collection('users')
    .where('cnp', '==', draft.cnp)
    .limit(1)
    .get()
  if (!cnpConflict.empty) {
    const conflict = cnpConflict.docs[0]
    throw new HttpsError(
      'already-exists',
      'A tenant with this CNP already exists.',
      {
        conflictUserId: conflict.id,
        conflictName: conflict.data().name,
      },
    )
  }

  // 3. CREATE AUTH ACCOUNT + PASSWORD — FR-AUTH-06 ──────────────────────────────
  const password = generatePassword()
  let createdUid = null
  try {
    const userRecord = await auth.createUser({
      email: draft.email,
      password,
      displayName: draft.name,
    })
    createdUid = userRecord.uid
  } catch (error) {
    // An existing email is a real tenant (they have an account), NOT an orphan —
    // so no compensation. The client is expected to have routed this draft
    // through the existing-user branch already (FR-TEN-07, Step 1 email check);
    // reaching here means that check was bypassed — fail clearly.
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError(
        'already-exists',
        'An account with this email already exists.',
      )
    }
    throw error
  }

  // 4. FIRESTORE TRANSACTION (verify + write, atomic) ───────────────────────────
  try {
    const tenancyRef = db.collection('tenancies').doc()
    const mailRef = db.collection('mail').doc()
    const userRef = db.collection('users').doc(createdUid)
    const propertyRef = db.collection('properties').doc(draft.propertyId)

    await db.runTransaction(async (tx) => {
      // ALL READS FIRST — the Admin SDK forbids a read after a write in a transaction.
      const cnpQuery = db
        .collection('users')
        .where('cnp', '==', draft.cnp)
        .limit(1)
      const activeTenancyQuery = db
        .collection('tenancies')
        .where('propertyId', '==', draft.propertyId)
        .where('status', '==', 'active')
        .limit(1)

      const [cnpSnap, activeSnap, propertySnap] = await Promise.all([
        tx.get(cnpQuery),
        tx.get(activeTenancyQuery),
        tx.get(propertyRef),
      ])

      // 4a. Re-verify — FR-TEN-22 / FR-TEN-23
      if (!cnpSnap.empty) {
        throw new HttpsError(
          'already-exists',
          'A tenant with this CNP already exists.',
        )
      }
      if (!propertySnap.exists) {
        throw new HttpsError(
          'not-found',
          'The selected property does not exist.',
        )
      }
      if (!activeSnap.empty) {
        throw new HttpsError(
          'failed-precondition',
          'The property is occupied; end the current tenancy first.',
          { reason: 'property-occupied' },
        )
      }
      const property = propertySnap.data()

      // 4b. Write users + tenancies + mail, flip the property, delete the draft —
      // all or nothing.
      tx.set(userRef, toUserDocument(draft))
      tx.set(
        tenancyRef,
        toTenancyDocument(draft, {
          userId: createdUid,
          ownerId: adminUid,
          tenantName: draft.name,
          property,
        }),
      )
      tx.set(
        mailRef,
        buildCredentialsEmail(draft.preferredLanguage, {
          name: draft.name,
          email: draft.email,
          password,
          property: property.name,
          url: APP_URL,
        }),
      )
      tx.update(propertyRef, { status: 'occupied' })
      tx.delete(draftRef)
    })

    // 6. RESPONSE — the credentials to the admin (SRS §7.2 note) + success signal.
    return {
      uid: createdUid,
      tenancyId: tenancyRef.id,
      email: draft.email,
      password,
      accountCreated: true,
    }
  } catch (error) {
    // 5. COMPENSATION — the transaction failed after the account was created; remove
    // the account so no orphan survives, then surface the ORIGINAL failure.
    if (createdUid) {
      await auth.deleteUser(createdUid)
    }
    throw error
  }
}

/**
 * The core, callable directly by the tests against the emulators. `adminUid` is the
 * calling admin's uid — it becomes the tenancy's `ownerId` (single admin, NFR-SEC-04).
 * Throws `HttpsError` with a clear code on every failure path.
 */
async function finalizeKycCore(draftId, adminUid) {
  const db = getFirestore()

  // 1. VALIDATE ────────────────────────────────────────────────────────────────
  const draftRef = db.collection('onboardingDrafts').doc(draftId)
  const draftSnap = await draftRef.get()
  if (!draftSnap.exists) {
    throw new HttpsError('not-found', `Draft ${draftId} does not exist.`)
  }
  const draft = draftSnap.data()

  // validateFullDraft already branches on existingUserId (mirrors the web schema,
  // CLAUDE.md §7): Steps 1-3 are required only when it is absent.
  const validation = validateFullDraft(draft)
  if (!validation.valid) {
    throw new HttpsError(
      'failed-precondition',
      'The draft is incomplete and cannot be finalized.',
      { issues: validation.issues },
    )
  }

  if (draft.existingUserId) {
    return finalizeExistingUserTenancy(db, draft, draftRef, adminUid)
  }

  const auth = getAuth()
  return finalizeNewTenant(db, auth, draft, draftRef, adminUid)
}

/**
 * The callable handler (admin only). Thin on purpose: it guards the admin claim and
 * the argument, then delegates to the testable core. Exported separately so the
 * auth guard can be tested without deploying the callable.
 */
async function finalizeKycHandler(request) {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
  const draftId = request.data?.draftId
  if (!draftId) {
    throw new HttpsError('invalid-argument', 'draftId is required.')
  }
  return finalizeKycCore(draftId, request.auth.uid)
}

const finalizeKyc = onCall(finalizeKycHandler)

module.exports = {
  finalizeKyc,
  finalizeKycHandler,
  finalizeKycCore,
  generatePassword,
}
