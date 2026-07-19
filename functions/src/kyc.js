const crypto = require('node:crypto')
const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { validateFullDraft } = require('./draftValidation')
const { buildCredentialsEmail } = require('./mail-templates/credentials')

/**
 * finalizeKyc (SRS §7.2, FR-TEN-16/18/22/23, FR-AUTH-06/07).
 *
 * Turns a completed onboarding draft into a real tenant: it validates the draft,
 * checks the CNP is unique and the property is free, creates the Auth account,
 * writes `users` + `tenancies` + the credentials email, deletes the draft — and
 * returns the credentials to the admin for face-to-face handover.
 *
 * Atomicity, in this exact order (the safety decisions taken with the admin):
 *  1. validate the draft (stop before touching anything if incomplete);
 *  2. pre-check the CNP against `users` (fail-fast, BEFORE Auth — a duplicate never
 *     creates an account);
 *  3. create the Auth account + generate the password (Auth is a separate system,
 *     it cannot join the Firestore transaction, so it happens first);
 *  4. a Firestore transaction re-checks CNP + property-free, then writes everything
 *     and deletes the draft — all or nothing;
 *  5. COMPENSATION: if the transaction fails AFTER the account was created, delete
 *     the account, so a failed finalize never leaves an orphan (a future
 *     "email already in use" then always means a real tenant — FR-TEN-07).
 */

if (!getApps().length) {
  initializeApp()
}

// The login URL that goes into the credentials email. Env-configurable so the same
// code serves the emulator and production; defaults to the local dev server.
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
 * out: contract data belongs to `tenancies`. */
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

/** The `tenancies` document (SRS §6) with the denormalizations: `tenantName` from
 * the user, `property { name, address }` from the property doc. */
function toTenancyDocument(draft, { userId, ownerId, property }) {
  const tenancy = {
    userId,
    ownerId,
    propertyId: draft.propertyId,
    tenantName: draft.name,
    property: { name: property.name, address: property.address },
    startDate: draft.startDate,
    endDate: draft.endDate,
    monthlyRent: draft.monthlyRent,
    dueDay: draft.dueDay,
    currentBalance: 0,
    status: 'active',
    attachedDocuments: [],
  }
  // securityDeposit is optional (FR-CON-01).
  if (draft.securityDeposit?.trim()) {
    tenancy.securityDeposit = draft.securityDeposit
  }
  return tenancy
}

/**
 * The core, callable directly by the tests against the emulators. `adminUid` is the
 * calling admin's uid — it becomes the tenancy's `ownerId` (single admin, NFR-SEC-04).
 * Throws `HttpsError` with a clear code on every failure path.
 */
async function finalizeKycCore(draftId, adminUid) {
  const db = getFirestore()
  const auth = getAuth()

  // 1. VALIDATE ────────────────────────────────────────────────────────────────
  const draftRef = db.collection('onboardingDrafts').doc(draftId)
  const draftSnap = await draftRef.get()
  if (!draftSnap.exists) {
    throw new HttpsError('not-found', `Draft ${draftId} does not exist.`)
  }
  const draft = draftSnap.data()

  const validation = validateFullDraft(draft)
  if (!validation.valid) {
    throw new HttpsError(
      'failed-precondition',
      'The draft is incomplete and cannot be finalized.',
      { issues: validation.issues },
    )
  }

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
    // An existing email is a real tenant (they have an account), NOT an orphan — so
    // no compensation. The existing-email → new-tenancy path is deferred to Sub-stage
    // E (wizard flow, FR-TEN-07); here we only fail clearly.
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
        )
      }
      const property = propertySnap.data()

      // 4b. Write users + tenancies + mail, delete the draft — all or nothing.
      tx.set(userRef, toUserDocument(draft))
      tx.set(
        tenancyRef,
        toTenancyDocument(draft, {
          userId: createdUid,
          ownerId: adminUid,
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
      tx.delete(draftRef)
    })

    // 6. RESPONSE — the credentials to the admin (SRS §7.2 note) + success signal.
    return {
      uid: createdUid,
      tenancyId: tenancyRef.id,
      email: draft.email,
      password,
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
