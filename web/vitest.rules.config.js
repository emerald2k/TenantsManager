import { defineConfig } from 'vitest/config'

// Banda de REGULI: testează firestore.rules direct pe emulatorul Firestore, prin
// @firebase/rules-unit-testing. Rulează în Node (nu jsdom) — nu există DOM aici,
// deci nici setup-ul jest-dom din banda rapidă. Include DOAR `*.rules.test.js`,
// exact inversul excluderii din vitest.config.js: cele două benzi nu se suprapun.
//
// Se rulează prin `npm run test:rules`, care pornește întâi emulatorul
// (firebase emulators:exec). Rulat direct cu vitest, testele nu au la ce se conecta.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.rules.test.js'],
    // Fișierele de reguli rulează UNUL DUPĂ ALTUL, nu în paralel.
    // Motiv: `initializeTestEnvironment` încarcă regulile în emulator per proiect,
    // iar emulatorul e pe singleProjectMode (firebase.json) — deci toate fișierele
    // împart același projectId. În paralel, fișierul care se încarcă al doilea
    // suprascrie regulile primului și îi face testele să pice aiurea.
    // Secvențial, fiecare fișier își încarcă regulile și le curăță la final.
    fileParallelism: false,
    // Prima conexiune la emulator + încărcarea regulilor depășesc uneori
    // timeout-ul implicit de 5s al Vitest.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
})
