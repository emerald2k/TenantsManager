# CLAUDE.md — Working guide for this project

This file is read automatically by Claude Code at every session. It contains the context and working rules for the **TenantsManager** project (tenant management platform).

---

## 1. Source of truth

**`SRS.md`** (in the project root) is the **complete and definitive specification**. It is the result of an extensive planning phase and contains: numbered functional requirements (FR-xxx), non-functional requirements (NFR-xxx), the data model, a page-by-page UI specification, the technical architecture, the milestone plan and the email templates.

**Absolute rules:**
- Read the SRS before generating any code. It is the reference for every decision.
- **Do not improvise** features, fields, rules or technologies that are not in the SRS. If something seems unclear or missing, **ask** — do not assume.
- When you implement something, reference the relevant requirements (e.g. "implementing FR-TEN-01…FR-TEN-24").
- If a contradiction or a gap appears in the SRS, flag it and ask for clarification before continuing.

---

## 2. Working mode: milestone by milestone

The project is built on **milestones** (section 9 of the SRS: M0–M7).

**Rules:**
- Work on **a single milestone at a time**, in order (M0 first).
- **Do not move to the next milestone without the user's explicit confirmation.**
- At the start of each milestone: briefly summarize what you will do and which FR/NFR requirements it covers.
- At the end of each milestone: check the "done" criterion defined in the SRS and report the state.
- Prefer small, verifiable steps over massive generation in one go. The user is learning along the way — explain the decisions as you make them.
- **Do not commit product code before the administrator's explicit validation.** Verify it yourself first (lint, build, behavior test), report the result, and WAIT for confirmation. Commits on a milestone branch are not a work journal — each one is a gate.

---

## 3. Technical stack (fixed — see section 7 of the SRS)

- **Frontend:** JavaScript (NOT TypeScript), Vite + React (SPA), React Router
- **UI:** Tailwind CSS + shadcn/ui
- **Forms:** React Hook Form + Zod
- **Data:** TanStack Query
- **Charts:** Recharts (Phase 2 only)
- **Backend (BaaS):** Firebase — Firestore, Authentication, Storage, Cloud Functions, the "Trigger Email" extension
- **i18n:** react-i18next (RO/EN)
- **Tests:** Vitest + React Testing Library
- **Code quality:** ESLint, Prettier, Husky + lint-staged, commitlint, .editorconfig
- **Config:** environment variables through `.env` (Vite); the Firebase keys are NOT hardcoded; `.env` in `.gitignore`
- **Structure:** monorepo — `web/` (frontend) and `functions/` (Cloud Functions) in separate folders
- **Deploy:** manual, Firebase CLI

**Do not introduce** technologies outside this list without asking (see "tooling consciously avoided" in the SRS: no TypeScript, Storybook, Docker, automatic CI/CD, Sentry in the MVP).

---

## 4. Local development

- Development (M0–M6) runs on the **Firebase Emulator Suite** (Auth, Firestore, Storage, Functions) + the free Spark plan. **No card, no cloud, no costs.**
- Moving to the Blaze plan + production deploy happens only at **M7**.
- Firebase project: `tenants-manager-2026`.

---

## 5. Git & conventions

**Branching model:**
- `main` — always stable and functional. Do not commit half-finished code here.
- `milestone/mX-name` — one branch per milestone (e.g. `milestone/m0-fundatie`). It is merged into `main` when the milestone is done and verified.

**Commits:** follow **Conventional Commits** — `<type>: <imperative description, lowercase>`.
- Types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `style`, `build`, `ci`.
- Examples: `feat: add property list page`, `chore: configure eslint and prettier`, `docs: update SRS`.
- Small, frequent commits, each with a clear purpose.

---

## 6. Quality principles

- **Clean code from the first line:** all code respects the ESLint/Prettier rules configured in M0.
- **Continuous testing — new code comes with tests (from M1):** testing is not piled up at the end. The testing foundation (Vitest + React Testing Library + jsdom) lands at **M1**; from there on **every feature is delivered with its own tests**, written together with the code, not retroactively. The end-to-end tests on the critical flows at M7 are final regression coverage, not the first moment of testing. See SRS §9.
- **Security:** the KYC data (CNP, ID photos, financial data, guarantor) is STRICTLY admin-only (see NFR-SEC-01…09 and the data model in SRS §6). The tenant only accesses denormalized data in `tenancies` and their own published `monthlyReports`. Check the Security Rules for every feature that touches sensitive data.
- **No format validation** on fields (NFR-VAL-01): fields are mandatory only as presence, without format checking (CNP, phone etc. accept anything). Do not add format validations unless the SRS explicitly requires them.
- **Localization:** all visible text goes through i18n (RO/EN) from the start, not hardcoded.
- **Explain the decisions:** the user is learning. When you make a non-trivial implementation decision, briefly explain the reasoning.

---

## 7. When to stop and ask

Stop and ask for clarification if:
- A requirement in the SRS seems ambiguous, contradictory or missing.
- You need a technology or a pattern that is not in the stack.
- A decision would affect the data model, security or an already-defined flow.
- You are about to move to the next milestone.

Better one extra question than one wrong assumption. The project's principle: **measure ten times, cut once.**
