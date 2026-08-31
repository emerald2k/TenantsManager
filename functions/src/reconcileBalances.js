const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { computeBalanceFromSignedReports } = require('./reports')
const { FINAL_TOTAL_EPSILON } = require('./schedulerLogic')
const {
  buildBalanceMismatchEmail,
} = require('./mail-templates/balanceMismatch')

/**
 * reconcileBalances (SRS §7.2, FR-SYS-05). Weekly, Monday 09:00
 * Europe/Bucharest — FR-SYS-04 fixes the time; the day is not specified by
 * the SRS, chosen as the start of the admin's working week.
 *
 * For every ACTIVE tenancy, recomputes its balance from its own chain of
 * signed reports (`computeBalanceFromSignedReports`, reports.js — the SAME
 * formula `onReportWrite` uses to derive `currentBalance` in the first
 * place) and compares it with the STORED value within `FINAL_TOTAL_EPSILON`
 * (NFR-VAL-03: money is never compared exactly). On a mismatch, emails
 * `ADMIN_EMAIL` naming the tenancy, the stored value, and the recomputed
 * one (A13).
 *
 * **Read-only, deliberately.** This function NEVER writes `currentBalance`
 * — an automatic correction would overwrite a real balance on the strength
 * of a calculation nobody had reviewed. It is the only thing in the product
 * that would ever notice `currentBalance` has drifted from what its own
 * signed reports say it should be — a lost trigger write, a deploy-window
 * gap, a broken chain — because every OTHER screen just reads whatever is
 * stored and trusts it.
 */

if (!getApps().length) {
  initializeApp()
}

const APP_URL = process.env.APP_URL || 'http://localhost:5173'

/**
 * The core loop, callable directly by the tests. Returns nothing — its
 * whole effect is `mail` writes (or none). Each tenancy is wrapped in its
 * own try/catch, the same "one malformed document cannot abort the whole
 * run" discipline `dailyScheduler` already documents — a single corrupt
 * tenancy must not hide a mismatch on every OTHER one.
 */
async function reconcileBalancesCore() {
  const db = getFirestore()

  // Same guard family as dailyScheduler's admin-facing families: nothing to
  // evaluate or send once there is nowhere to report a mismatch. Logged
  // ONCE per run, not per tenancy.
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail) {
    console.error(
      'reconcileBalances: ADMIN_EMAIL is not set — skipping this run ' +
        'entirely, since a mismatch would have nowhere to be reported.',
    )
    return
  }

  const snap = await db
    .collection('tenancies')
    .where('status', '==', 'active')
    .get()

  for (const doc of snap.docs) {
    try {
      const tenancy = doc.data()
      const stored = tenancy.currentBalance ?? 0
      const recomputed = await computeBalanceFromSignedReports(doc.id)

      if (Math.abs(stored - recomputed) > FINAL_TOTAL_EPSILON) {
        const mailRef = db.collection('mail').doc()
        await mailRef.set(
          buildBalanceMismatchEmail({
            email: adminEmail,
            name: tenancy.tenantName,
            property: tenancy.property.name,
            total: stored,
            arrearsAmount: recomputed,
            url: APP_URL,
            relatedId: doc.id,
            ownerId: tenancy.ownerId,
          }),
        )
      }
    } catch (error) {
      console.error(
        `reconcileBalances: tenancy ${doc.id} failed — continuing with the rest.`,
        error,
      )
    }
  }
}

const reconcileBalances = onSchedule(
  { schedule: '0 9 * * 1', timeZone: 'Europe/Bucharest' },
  reconcileBalancesCore,
)

module.exports = {
  reconcileBalances,
  reconcileBalancesCore,
}
