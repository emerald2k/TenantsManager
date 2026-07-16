import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  assertFails,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// Smoke-ul benzii de reguli (sub-etapa A): dovedește că harness-ul funcționează
// cap-coadă — emulator pornit, firestore.rules încărcate, allow/deny observabil.
// Nu testează o colecție de produs: la A nu există niciuna. Prima regulă reală
// (properties, NFR-SEC-02) vine la sub-etapa B și se sprijină pe schela asta.
//
// Ce verificăm: deny-ul global din firestore.rules de acum („nicio colecție
// implementată încă"). Testul e și o plasă de siguranță — dacă cineva deschide
// din greșeală regulile la rădăcină, pică aici.

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'tenants-manager-2026',
    firestore: {
      rules: readFileSync(
        path.resolve(process.cwd(), '../firestore.rules'),
        'utf8',
      ),
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

describe('firestore.rules — deny global (M0)', () => {
  it('refuză citirea unui document de către un utilizator autentificat', async () => {
    const db = testEnv.authenticatedContext('user-oarecare').firestore()

    await assertFails(getDoc(doc(db, 'orice/document')))
  })

  it('refuză scrierea unui document de către un utilizator autentificat', async () => {
    const db = testEnv.authenticatedContext('user-oarecare').firestore()

    await assertFails(setDoc(doc(db, 'orice/document'), { camp: 'valoare' }))
  })

  it('refuză citirea unui document de către un vizitator neautentificat', async () => {
    const db = testEnv.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, 'orice/document')))
  })
})
