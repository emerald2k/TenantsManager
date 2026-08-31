# M8 — approved visual design

Two mockups, both approved by the administrator (August 2026). They are the
reference for every M8 surface. They are **static HTML, not product code** — no
React, no Tailwind, no design tokens from `index.css`. Read them for layout,
density, colour roles and interaction behaviour; do not copy their CSS.

| File                     | Scope                                          | Approved |
| ------------------------ | ---------------------------------------------- | -------- |
| `dashboard-desktop.html` | Desktop **and tablet** — one layout, one scale | yes      |
| `dashboard-mobile.html`  | Phone shell, both themes, down to 320 px       | yes      |

Live, interactive copies (the mobile file renders four phone frames that scroll):

- desktop/tablet — https://claude.ai/code/artifact/fe1fc5df-8fcc-437d-be8e-22fe3899c92e
- phone — https://claude.ai/code/artifact/fb8d8b0a-c715-4204-9bfa-ebdae7316325

## What is normative, and where it is written down

The mockups illustrate; **`SRS.md` governs**. When they disagree, the SRS wins
and the mockup is stale.

| Concern                                                           | Requirement       |
| ----------------------------------------------------------------- | ----------------- |
| Light + dark themes, applied before first paint                   | NFR-UX-04         |
| Exports always light                                              | NFR-UX-05         |
| Affordance: cursor, motion, permanent marker                      | NFR-UX-06         |
| The interaction legend is a design document, **it does not ship** | NFR-UX-07         |
| Responsive: desktop/tablet identical, phone shell, 320 px floor   | NFR-UX-03         |
| Dashboard content and tiles                                       | FR-DASH-01, 04…14 |
| Current month table — **seven** columns                           | FR-DASH-02b, 02c  |
| History chart — **one** series, Billed only                       | FR-DASH-09b       |

## Where the mockup is deliberately stale

One place, recorded so nobody "fixes" the product back to the picture.

**The history chart has two series in the mockup — Încasat and Facturat. The
product ships one: Billed.** Administrator's decision, 2026-08-30, written into
**FR-DASH-09b**, which is what governs. A twelve-month Collected series needs a
rolling window over `paymentDate` spanning two calendar years; the page's report
query is filtered by a single `year`, so a report billed in December and paid in
January falls outside it and the series comes out **silently low**. It was
declined rather than approximated. The mockup's chart title, its legend, its
per-bar tooltips and the paragraph beneath it all describe the two-series
version and are stale in the same way.

**The phone title bar's bell shows a badge reading "3" in the mobile mockup. It
ships with no count.** There is no read/unread state in the model — `notifications`
is a read-only projection of `mail` — so there was nothing to count. NFR-UX-03
carried the same false claim and has been corrected. **No count is coming**
(owner decision, 2026-08-30): there is no document for the administrator anywhere
in §6, so a "last seen" timestamp would have meant a new collection and a new
security rule for a badge. The bell is a shortcut to the notifications page.

**The mobile mockup's "More" sheet lists Notificări and Temă, which also appear
as icons in the phone title bar. That duplication is deliberate and stays.** The
title-bar controls are icon-only; an icon-only bell is not an affordance for a
non-technical user (NFR-UX-06 rule 3), so the sheet holds the labelled route. The
theme row carries its **state** ("Temă · Deschisă"), never an action label.

## Three decisions that are easy to undo by accident

1. **No element translates on the Y axis on hover.** An explicit owner decision.
   Hover changes border, background, text colour and shadow **in place**; the
   only things that move are the direction marker `›` and a tooltip entering.
   Every hover rule sits inside `@media (hover:hover)` — a hover state latches
   on touch and never clears.
2. **The permanent `›` marker stays**, alongside the hover reaction, not instead
   of it. It is the only affordance a phone or tablet user gets before touching.
3. **Five bottom tabs maximum on the phone**, with the sixth destination in the
   title bar and the rest in a "More" sheet. Adding a sixth tab makes every tab
   too narrow to hit reliably.

## Not in the mockups

The mockups cover the **admin dashboard** only. The tenant portal, the KYC
wizard, the payments ledger page, the notification log and `/r/:shareToken`
inherit the same shell, palette and interaction rules but have no approved
mockup of their own — build them from SRS §5.3 and match what is here.
