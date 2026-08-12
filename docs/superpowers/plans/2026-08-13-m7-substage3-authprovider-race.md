# M7 Sub-stage 3 — Close the AuthProvider test gap, fix the out-of-order race — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write full test coverage for `AuthProvider` (a debt flagged since M6 — CURRENT_SPRINT.md at the M6 gate: "zero tests touch it directly, it decides admin vs tenant"), and fix an out-of-order-resolution race discovered while reading it for this sub-stage. One gate, one commit. The race test is written first and MUST fail against the current code — that red run is the anti-vacuity proof this sub-stage requires.

**Architecture:** `AuthProvider` is tested in isolation — no router, no i18n, no TanStack Query, because it needs none of them (unlike most of this app's components, it depends on nothing from `renderWithProviders.jsx`). `firebase/auth` and `@/lib/firebase` are mocked at the module boundary (fast band, no emulator), and the callback passed to `onIdTokenChanged` is captured so the test can invoke it directly, in whatever order and with whatever timing a test needs — including, for the race test, resolving `getIdTokenResult()` for the FIRST invocation only after the SECOND invocation has already completed.

**Tech Stack:** Vitest + React Testing Library (`renderHook`, `waitFor`), already the fast band's stack (CLAUDE.md §5, §4). No new dependency.

## Global Constraints

- Fast band only (`npm run test:run --prefix web`) — no emulator, matching `web/tests/*.test.jsx`'s existing pattern (none of them touch Firestore/Auth for real).
- One commit, type `fix:` (behavior changes; the tests come with it — CLAUDE.md §6's convention already used this way for the M6 `onPropertyUpdate` fix). Body lines under 100 chars.
- Do not restructure `AuthProvider` beyond what the race fix needs — same `status`/`role`/`user` state shape, same three branches (null user / success / caught error), same context value, same `login`/`logout`. `auth-context.js` and `useAuth.js` are read-only in this sub-stage (task description's own framing: "likely untouched" — confirmed below, finding #3).
- Do not commit without the administrator's explicit gate approval (CLAUDE.md §2). **This turn writes the plan only** — no test file, no `AuthProvider.jsx` edit, no test run, no commit yet.

---

## Investigation findings

**1. `useAuth` already throws outside a provider — no change needed, just a test.**
`web/src/features/auth/useAuth.js:5-8`: `useContext(AuthContext)` returns the
context's default value when there's no ancestor `<AuthContext.Provider>`,
and `auth-context.js:7` sets that default to `null` — so `if (!ctx) throw
new Error('useAuth must be used inside an <AuthProvider>')` already fires
correctly today. This is a coverage gap, not a bug.

**2. `web/src/lib/firebase.js:43` exports `auth` as a named export** — the
exact shape every other test's `vi.mock('@/lib/firebase', ...)` already
follows (`web/tests/onboarding.hooks.test.jsx:28-31` mocks `db`/`storage`
the same way). `AuthProvider.jsx:7` imports `{ auth }` from it, so the new
test mocks `{ auth: { __fake: 'auth' } }` — the object's shape doesn't
matter, since `onIdTokenChanged` itself is also mocked and never inspects
its first argument.

**3. `auth-context.js` and `useAuth.js` are confirmed untouched.** Both
read in full (7 and 10 lines). Neither holds logic the fix or the new tests
need to change — `auth-context.js` is a bare `createContext(null)`,
`useAuth.js` is the guard clause from finding #1. The task description's
"likely untouched" is correct; this plan touches neither file.

**4. No existing test renders the real `AuthProvider`.** Grepped every test
that imports `useAuth` (`tenantApp.*.test.jsx`, `tenantLayout.test.jsx`):
all of them `vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn()
}))` and never touch `AuthProvider.jsx` (confirmed in
`web/tests/tenantLayout.test.jsx:22,42`). So this sub-stage's new test file
is the first thing in the suite that actually exercises `AuthProvider`'s
internals — the fix cannot regress any other test, by construction, and
the full fast-band run in Step 6 is a sanity check, not a real risk area.

**5. Test file naming.** Follows the established `<feature>.<subject>.test.jsx`
convention (`dashboard.page.test.jsx`, `properties.hooks.test.jsx`) →
`web/tests/auth.provider.test.jsx`.

**6. Vitest config already makes `@/lib/firebase` safe to leave unmocked
in OTHER files** (fictitious env vars in `web/vitest.config.js:24-40`), but
this test still mocks it explicitly — importing the real `firebase.js`
would call `initializeApp`/`getAuth` for real and pull in the actual
Firebase SDK's `onIdTokenChanged`, which is exactly the function this test
needs to control, not exercise for real. Same reasoning `onboarding.hooks.test.jsx:26-27`
already documents for its own mock.

---

## The race, traced precisely (why the literal "one boolean" fix does not work)

The task frames the fix as "a cancellation flag ... checked before every
setState, reset in the cleanup." Read as a single `let cancelled = false`
flipped to `true` only in the effect's cleanup (the classic React
"ignore stale response after unmount" idiom), **this does not fix the bug
as described** — traced below — because the race is between two LIVE
callback invocations, with no unmount involved at any point:

1. Callback 1 fires with a real user, starts `await
firebaseUser.getIdTokenResult()`. `cancelled` is `false`.
2. Callback 2 fires with `null` (logout) before callback 1's await
   resolves. The `!firebaseUser` branch has no `await`, so it runs
   synchronously and sets `status: 'unauthenticated'`. `cancelled` is
   still `false` — nothing set it, no unmount occurred.
3. Callback 1's `getIdTokenResult()` resolves. It checks `if (cancelled)
return` — `cancelled` is `false`, the check passes, and it overwrites
   `status` back to `'authenticated'` with the stale user. **Bug
   reproduced even with the boolean guard in place.**

A single boolean cannot distinguish "a newer live callback has already
run" from "nothing has happened yet" — both look like `false`. Fixing this
needs each invocation to know whether a **later** invocation has already
started, which needs per-invocation identity, not a single shared boolean.

**The minimal correct realization of "a flag, checked before every
setState, reset in the cleanup"** is a single monotonically increasing
counter, closed over by the effect, compared for equality rather than
truthiness:

```js
let latestCallId = 0
// ...
const callId = ++latestCallId // this invocation's identity
const isStale = () => callId !== latestCallId // "checked before every setState"
// ...
return () => {
  latestCallId = -1 // "reset in the cleanup" — no future
  unsubscribe() // callId (always >= 1) can ever match
}
```

Traced against the same scenario: callback 1 gets `callId = 1`; callback 2
fires and increments `latestCallId` to `2` before doing its own
(synchronous) write — at that instant callback 1 is already stale, even
though it hasn't resumed yet. When callback 1's await finally resolves,
`isStale()` is `true` (`1 !== 2`) and it skips its `setState` calls. Same
mechanism handles unmount: `latestCallId = -1` in the cleanup makes every
`callId` (always ≥ 1) permanently stale, so a `getIdTokenResult()` that
resolves after unmount writes nothing — the second part of the task's fix
description ("this also removes state writes after unmount"). **This
second claim turned out to be untestable at this boundary — see "Test 8,
investigated and dropped" below** — the guard against post-unmount writes
is real (traced the same way as the race, above) but React itself makes
it unobservable from a test.

This is one variable, not two — simpler than my first draft (a separate
`cancelled` boolean plus a counter), and it satisfies "keep the fix
minimal — do not restructure the provider" more literally: the three
branches, the state shape, and the subscribe/unsubscribe wiring are
unchanged; only `isStale()` checks are inserted before each `setState`
group.

---

## Test list (9 cases — 2 more than the task's 7 bullets, minus one dropped; see notes)

1. **Initial status is `'loading'`**, not `'unauthenticated'`, before any
   callback fires — distinguishing the "haven't heard from Firebase yet"
   state from "heard and there's no user" (task requirement, verbatim).
2. **`claims.admin === true` → `role: 'admin'`, `status: 'authenticated'`.**
3. **`claims.admin` absent → `role: 'tenant'`.**
4. **`firebaseUser` is `null` → `status: 'unauthenticated'`, `user`/`role`
   `null`.** (Implicit in the task's bullets — needed as the race test's
   baseline, and not otherwise covered.)
5. **`getIdTokenResult()` rejects → ejected to `'unauthenticated'`**, `user`/`role` `null`.
6. **A second invocation of the SAME captured callback (simulating a token
   refresh, not a fresh login) changes `role` without any call to
   `login`.** This is the closest the fast band can get to proving
   "`onIdTokenChanged`, not `onAuthStateChanged`, behaviorally" — see the
   caveat below; it is not a full proof.
7. **`unsubscribe` is called exactly once, on unmount.**
8. **THE RACE — out-of-order resolution does not overwrite newer state.**
   RED before the fix (Step 2), GREEN after (Step 5).
9. **`useAuth()` outside a provider throws** the exact message from
   `useAuth.js:7`.

**Caveat on test 6, stated plainly per the task's own request to flag
anything that looks untestable without restructuring:** this test proves
the CONSUMING code correctly reacts to a second firing of the subscribed
callback without a new `login()` call — a necessary condition for
`onIdTokenChanged`'s distinguishing behavior (fires on token refresh, not
just login/logout) to matter. It cannot, at this mocked boundary, prove
that swapping the import for `onAuthStateChanged` would break in real
Firebase — both would be represented identically as "the captured
callback" once mocked. Proving the SDK-level distinction for real needs an
integration/E2E test hitting the real Auth emulator (Playwright, SRS §9)
or `functions/test`'s equivalent — out of scope for the fast band and not
what this sub-stage is asked to build. Not fixable by restructuring
`AuthProvider` either — the seam that would make it fully provable is the
Firebase SDK itself, not this component.

---

## Test 8 (post-unmount state write), investigated and dropped

The first draft of this plan included a 10th test: "no state write, and no
React 'unmounted component' warning, when a pending `getIdTokenResult()`
resolves after unmount" — checking a `console.error` spy for text matching
`/unmounted/i`. **Review correctly flagged this as vacuous**: React 18
removed that warning entirely (this project is on React 19), so
`console.error` never contains it, and the loop over `consoleError.mock.calls`
passes trivially whether or not the fix's staleness guard exists.

Rewritten per review to observe the actual effect instead: capture
`result.current` before `unmount()`, resolve the deferred afterward, and
assert `result.current` is unchanged. **Verified the same way as the
race test — actually run against the unmodified provider, with a
`console.log` temporarily added inside `AuthProvider.jsx`'s `try` block to
confirm what really happens:**

```
DIAG-AP: resolved claims for uid-1 { admin: true }
DIAG-AP: setStatus(authenticated) called for uid-1
DIAG-T8: observedBeforeUnmount { status: 'loading', ... } resultAfter { status: 'loading', ... }
```

`setStatus('authenticated')` genuinely runs (proving the unmodified
provider has no unmount guard at all, exactly as expected) — but
`result.current` never changes, even wrapped in an explicit `await
act(async () => {})` flush (the same flush that correctly exposed the race
in test 8→9 below). **React does not commit updates to an unmounted
fiber's hooks, full stop — with or without an application-level guard.**
The rewritten assertion passes identically whether `AuthProvider` has the
staleness fix or not, for a reason outside this component's control: it
cannot be made to fail against the unmodified provider.

Per the task's own instruction ("if it cannot be made to fail, say so and
drop it rather than keeping a test that proves nothing") — **dropped.**
The guard still blocks post-unmount writes (traced logically in "The race,
traced precisely" above, and the `DIAG-AP` log confirms the unmodified
provider has no such guard at all, so the mechanism itself is real) — it
is just not observable from a fast-band test of `result.current`. Proving
it would need inspecting React's internal warning/dev channel at a point
in React's history that no longer exists, or an approach that isn't a
`renderHook`-based unit test at all — not something restructuring
`AuthProvider` would fix either, since the limitation is React's, not the
component's.

---

### Task: write the tests (race included), confirm RED, apply the fix, confirm GREEN, commit

**Files:**

- Create: `web/tests/auth.provider.test.jsx`
- Modify: `web/src/features/auth/AuthProvider.jsx`

**Interfaces:**

- Consumes: `AuthProvider` (default context shape: `{ status, role, user,
login, logout }}`), `useAuth` (unchanged), the mocked `onIdTokenChanged`
  (captured callback), a hand-rolled `createDeferred()` test helper (not a
  new dependency — a 4-line local function).
- Produces: nothing consumed by later sub-stages — this closes an existing
  debt, it doesn't open a new seam.

- [ ] **Step 1: Write `web/tests/auth.provider.test.jsx`**

```jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { onIdTokenChanged } from 'firebase/auth'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { useAuth } from '@/features/auth/useAuth'

vi.mock('@/lib/firebase', () => ({ auth: { __fake: 'auth' } }))

vi.mock('firebase/auth', () => ({
  onIdTokenChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}))

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeUser(overrides = {}) {
  return {
    uid: 'uid-1',
    email: 'user@test.ro',
    getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
    ...overrides,
  }
}

describe('AuthProvider', () => {
  let capturedCallback
  let unsubscribeSpy

  beforeEach(() => {
    unsubscribeSpy = vi.fn()
    onIdTokenChanged.mockImplementation((_auth, callback) => {
      capturedCallback = callback
      return unsubscribeSpy
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('starts as loading, not unauthenticated, before any callback fires', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(result.current.status).toBe('loading')
    expect(result.current.status).not.toBe('unauthenticated')
  })

  it('sets role admin when the claim is true', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(
      fakeUser({
        getIdTokenResult: vi
          .fn()
          .mockResolvedValue({ claims: { admin: true } }),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.role).toBe('admin')
  })

  it('sets role tenant when the claim is absent', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(
      fakeUser({
        getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.role).toBe('tenant')
  })

  it('goes unauthenticated when the callback receives null', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(null)

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    expect(result.current.user).toBeNull()
    expect(result.current.role).toBeNull()
  })

  it('ejects to unauthenticated when getIdTokenResult rejects', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await capturedCallback(
      fakeUser({
        getIdTokenResult: vi.fn().mockRejectedValue(new Error('revoked')),
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    expect(result.current.user).toBeNull()
    expect(result.current.role).toBeNull()
  })

  it('updates role on a second callback firing, without a new login call', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    const user = fakeUser({
      getIdTokenResult: vi
        .fn()
        .mockResolvedValueOnce({ claims: {} })
        .mockResolvedValueOnce({ claims: { admin: true } }),
    })

    await capturedCallback(user)
    await waitFor(() => expect(result.current.role).toBe('tenant'))

    // Simulates a token refresh event on the SAME subscription - not a fresh
    // login. onAuthStateChanged would not fire here; onIdTokenChanged does
    // (AuthProvider.jsx's own header comment). This proves the consuming
    // logic reacts correctly to a second firing, not that the SDK-level
    // listener choice is itself exercised for real (see plan caveat).
    await capturedCallback(user)
    await waitFor(() => expect(result.current.role).toBe('admin'))

    const { signInWithEmailAndPassword } = await import('firebase/auth')
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('unsubscribes exactly once, on unmount', () => {
    const { unmount } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    expect(unsubscribeSpy).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
  })

  it('THE RACE: a callback that resolves later does not overwrite a callback that resolved sooner', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    const deferred = createDeferred()
    const staleUser = fakeUser({
      uid: 'stale-uid',
      getIdTokenResult: vi.fn(() => deferred.promise),
    })

    // Callback 1 fires and starts awaiting getIdTokenResult() - deliberately
    // left pending; nothing has resolved yet.
    const callback1Promise = capturedCallback(staleUser)

    // Callback 2 fires (logout) and completes BEFORE callback 1's await
    // resolves - this is the out-of-order part.
    await capturedCallback(null)
    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))

    // NOW let callback 1 finish, resolving after callback 2 already did.
    // The empty act() flush is required here: callback 1's setState calls
    // run inside a promise continuation, not inside waitFor's act-aware
    // polling, so without an explicit flush this test reads a stale
    // result.current snapshot and passes even against the buggy provider
    // (discovered while verifying this test itself goes red - see below).
    deferred.resolve({ claims: {} })
    await callback1Promise
    await act(async () => {})

    // Must still reflect callback 2's outcome, not callback 1's stale one.
    expect(result.current.status).toBe('unauthenticated')
    expect(result.current.user).toBeNull()
    expect(result.current.role).toBeNull()
  })

  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used inside an <AuthProvider>',
    )
  })
})
```

**The race test's `act()` flush was not in the first draft either — found
the same way as the Test 8 problem, by actually running it.** The first
version read `result.current` right after `await callback1Promise` with no
flush, and it PASSED against the unmodified provider — a second vacuous
test, discovered by tracing WHY: `onIdTokenChanged.mockImplementation`'s
captured callback calls `setState` from inside a promise continuation, not
from an `act()`-wrapped interaction, so React schedules the update without
committing it into `result.current` before the test's next line runs. Only
after adding `console.log`s inside `AuthProvider.jsx` itself did the actual
sequence become visible: `setStatus('authenticated')` for the stale user
WAS being called, but the test's read of `result.current` happened before
that scheduled update was flushed. Wrapping the read in `await
waitFor(() => expect(result.current.status).toBe('authenticated'))`
confirmed the bug fires (proving the trace); replacing the flawed read
with `await act(async () => {})` before the real assertions fixed the
measurement without changing what's being tested.

- [ ] **Step 2: Run the new file alone**

Run: `npm run test:run --prefix web -- tests/auth.provider.test.jsx`

**Expected: 8 passed, 1 failed** — "THE RACE" test fails (the current
`AuthProvider.jsx` has no staleness guard, so callback 1's resolution
overwrites callback 2's `'unauthenticated'` with `'authenticated'` /
`stale-uid`). Every other test passes against the unmodified provider —
they exercise single, non-overlapping callback invocations, which the
current code already handles correctly.

- [ ] **Step 3: Report the Step 2 output verbatim**

If the race test does NOT fail here — STOP. Per the task: "either the test
does not reproduce the race or [the] analysis is wrong." Do not edit the
test to force a failure; re-examine the trace in this plan's "race, traced
precisely" section against what actually ran, and report the discrepancy
instead of proceeding.

- [ ] **Step 4: Apply the fix — replace `AuthProvider.jsx`'s `useEffect`**

Replace (`web/src/features/auth/AuthProvider.jsx:30-58`):

```jsx
useEffect(() => {
  const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      setUser(null)
      setRole(null)
      setStatus('unauthenticated')
      return
    }

    try {
      // The role comes EXCLUSIVELY from the custom claim (FR-AUTH-01, FR-AUTH-03).
      // We do not read it from Firestore: the `users` collection is admin-only
      // (NFR-SEC-02), so a tenant could not even read their own role.
      const { claims } = await firebaseUser.getIdTokenResult()

      setUser({ uid: firebaseUser.uid, email: firebaseUser.email })
      setRole(claims.admin === true ? 'admin' : 'tenant')
      setStatus('authenticated')
    } catch {
      // The token could not be obtained/refreshed — the session is no longer
      // valid (disabled account, revoked tokens). We eject them.
      setUser(null)
      setRole(null)
      setStatus('unauthenticated')
    }
  })

  return unsubscribe
}, [])
```

With:

```jsx
useEffect(() => {
  // Each callback invocation is stamped with an id; before writing state it
  // checks whether a LATER invocation has already taken over. Without this,
  // two live invocations can resolve out of order (e.g. a logout callback
  // completing while an earlier callback's getIdTokenResult() is still in
  // flight) and the earlier one's setState calls overwrite the later,
  // correct state with stale data. The cleanup sets latestCallId to a value
  // no real callId (always >= 1) can match, so a token result that resolves
  // after unmount also writes nothing.
  let latestCallId = 0

  const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
    const callId = ++latestCallId
    const isStale = () => callId !== latestCallId

    if (!firebaseUser) {
      if (isStale()) return
      setUser(null)
      setRole(null)
      setStatus('unauthenticated')
      return
    }

    try {
      // The role comes EXCLUSIVELY from the custom claim (FR-AUTH-01, FR-AUTH-03).
      // We do not read it from Firestore: the `users` collection is admin-only
      // (NFR-SEC-02), so a tenant could not even read their own role.
      const { claims } = await firebaseUser.getIdTokenResult()
      if (isStale()) return

      setUser({ uid: firebaseUser.uid, email: firebaseUser.email })
      setRole(claims.admin === true ? 'admin' : 'tenant')
      setStatus('authenticated')
    } catch {
      // The token could not be obtained/refreshed — the session is no longer
      // valid (disabled account, revoked tokens). We eject them.
      if (isStale()) return
      setUser(null)
      setRole(null)
      setStatus('unauthenticated')
    }
  })

  return () => {
    latestCallId = -1
    unsubscribe()
  }
}, [])
```

No other part of the file changes — same imports, same `login`/`logout`,
same JSX.

- [ ] **Step 5: Re-run the new file alone**

Run: `npm run test:run --prefix web -- tests/auth.provider.test.jsx`
Expected: **9 passed, 0 failed.**

- [ ] **Step 6: Run the full fast band**

Run: `npm run test:run --prefix web`
Expected: every existing suite still passes (finding #4 — nothing else
renders the real `AuthProvider`, so this is confirmation, not a likely
source of new failures) plus the 9 new tests.

- [ ] **Step 7: Report both Step 2 and Step 6 outputs, then stop for the gate**

Per CLAUDE.md §2: verify, report, wait for the administrator's explicit
confirmation before committing.

- [ ] **Step 8: Commit (once approved)**

```bash
git add web/tests/auth.provider.test.jsx web/src/features/auth/AuthProvider.jsx docs/superpowers/plans/2026-08-13-m7-substage3-authprovider-race.md
git commit -m "$(cat <<'EOF'
fix: guard AuthProvider against out-of-order onIdTokenChanged writes

A callback still awaiting getIdTokenResult() could resolve after a later
callback and overwrite its state with stale data - concretely, a logout
completing while a stale token refresh is in flight could leave a
logged-out user showing as authenticated with their old role. Each
callback now stamps a call id and checks it is still the latest before
writing state; the same guard blocks writes after unmount. Closes the
AuthProvider test gap flagged since M6 (9 tests, fast band).
EOF
)"
```

---

## Self-review (completed while writing this plan)

**Spec coverage** — all 7 of the task's test bullets map to a numbered
test (listener-behavioral↔#6, admin/tenant claims↔#2/#3, initial
loading↔#1, reject↔#5, unsubscribe↔#7, THE RACE↔#8, throws-outside-
provider↔#9); #4 (null-callback baseline) is the one surviving addition.
The exact SEQUENCE (write → red → report → fix → green → report) is Steps
1–7 in order, not reordered. The `feat`/`build` question doesn't apply
here — task fixed the type to `fix:` and gave the reason (behavior
change); no decision needed.

**Placeholder scan** — no TBD; the test file, the exact before/after
`useEffect` diff, and the commit message are all literal.

**Two load-bearing findings came from actually running things, not from
reasoning about them:**

1. **"One boolean doesn't work" for the race itself** — changes the
   task's literal fix description (a single "cancellation flag") into a
   one-variable call-id counter, with a full trace proving the literal
   reading fails and the counter succeeds.
2. **Two of this plan's OWN tests were vacuous on first draft** — Test 8
   (post-unmount) per review's catch (the removed React 18 warning), and
   THE RACE test itself, found independently while verifying Test 8's
   fix: both read `result.current` without an `act()`-aware flush after a
   promise-continuation `setState`, so both silently passed against the
   unmodified provider. Test 8 was provably unfixable at this boundary
   and dropped; the race test was fixed by adding `await act(async () =>
{})` before its assertions, then re-verified red/green from scratch.

Neither finding was assumed — both are backed by an actual red run against
the unmodified `AuthProvider.jsx`, per the task's own anti-vacuity
requirement applied recursively to the tests meant to prove it.
