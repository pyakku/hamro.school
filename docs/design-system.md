# Hamro.school — design system

Carries the marketing site's identity into the product.

> The interactive prototype this describes (`app-prototype.html` — attendance
> register, homework, fees) is the reference implementation for these rules.
> Drop it in this folder alongside this file; the attendance screen in it is the
> spec for session 3.

## Tokens

Implemented as Tailwind v4 theme variables in
[apps/web/src/styles/theme.css](../apps/web/src/styles/theme.css), so `bg-ink`,
`text-ink-45` and `font-display` exist as utilities.

```css
:root{
  /* colour */
  --ink:#14243C;        /* text, rail, primary buttons */
  --ink-70:#3D4E68;     /* secondary text */
  --ink-45:#6E7B8F;     /* labels, metadata */
  --ink-20:#B4BCC8;     /* disabled */
  --paper:#EDEEEA;      /* app background */
  --card:#F8F8F5;       /* panel headers, footers, stats */
  --white:#FFFFFF;      /* data surfaces */
  --rule:rgba(20,36,60,.13);
  --rule-soft:rgba(20,36,60,.07);
  --marigold:#E9A21B;   /* active state, late, brand accent */
  --marigold-deep:#C7860E;
  --stamp:#B33A2E;      /* absent, overdue, destructive */
  --jade:#2A7A66;       /* present, paid, success */

  /* type */
  --display:"Bricolage Grotesque";  /* headings only */
  --body:"Mukta";                   /* everything readable */
  --mono:"IBM Plex Mono";           /* labels, numbers, IDs, dates */

  --r:3px;  /* the only border radius, except pills and avatars */
}
```

### Colour rules

Jade, stamp and marigold are **semantic, not decorative**. Jade always means
present or paid. Stamp always means absent, overdue or destructive. Marigold
means active, pending or late. Never use one of them because a screen needs
colour — a person should be able to read status from colour alone across the
whole product.

Ink is the only dark. There is no separate grey scale; every muted tone is ink
at reduced opacity.

## Type

| Role | Face | Size | Notes |
|---|---|---|---|
| Page title | Display 700 | 26px | `font-variation-settings:"wdth" 94` |
| Panel heading | Display 700 | 15px | |
| Body / table cell | Body 400–500 | 14.5px | |
| Column header | Mono 500 | 9.5px | uppercase, `letter-spacing:.12em` |
| Field label | Mono 500 | 10px | uppercase, `.13em` |
| Numbers, IDs, dates, times | Mono 400 | 11–13px | **always mono** |
| Stat value | Display 700 | 26px | |

The single strongest rule: **every number is mono, every prose string is
Mukta.** Roll numbers, percentages, amounts, invoice IDs, timestamps, counts.
This is what makes the product read as a register rather than a dashboard, and
it costs nothing to follow.

## What changed from the marketing site, and why

The site is read once at 17px. The app is used for six hours at a stretch. Four
deliberate departures:

1. **Body type down to 14.5px** and line-height to 1.55. Marketing prose wants
   air; a register wants rows on one screen.
2. **The ruled-paper background is gone.** Texture behind a page of real data is
   noise. The rule survives as actual table borders, which is where it was
   always doing the work.
3. **Hard offset shadows only on primary buttons.** On the site they were a
   motif; in an app, on every panel, they'd be clutter. Panels get a 1px ink
   border instead.
4. **The red margin line became the rail's right border.** Same artifact,
   load-bearing instead of decorative — it separates navigation from work.

Everything else — palette, faces, mono-for-data, 3px radius, the ink/paper
contrast — is unchanged.

## Layout

- **Left rail** 236px, ink background, sticky full height, 3px stamp-red right
  border. Nav grouped by *when you'd use it* (Today / Accounts / School), not by
  data model.
- **Topbar** 56px: breadcrumb left, date and term right. The date is always
  visible — half of school work is date-dependent.
- **Content** max-width 1080px, 24px padding.
- **Under 900px** the rail becomes a bottom tab bar, tables reflow to stacked
  cards, and every tap target grows to 44px. Teachers will use this on a phone
  more than a laptop.

## Components

**Panel** — white body, 1px ink border, 3px radius. Header and footer in
`--card`, separated by a 1.5px ink line. This is the register, and it's the
workhorse of the whole product.

**Data table** — CSS grid, not `<table>`, so it can reflow on mobile. Mono
uppercase column headers, `--rule-soft` row borders, `--card` on hover, and a
tinted row background when a row carries status.

**Segmented control** (P / A / L) — the attendance primitive. Mono, 32px tall on
desktop, 44px on mobile, filled with the semantic colour when selected.

**Sticky action bar** — lives inside the panel at its foot, holds the running
tally and the primary action. Never a floating button.

**Unsaved stamp** — mono, uppercase, stamp-red outline, rotated `-1.5deg`. The
one piece of whimsy in the product, and it earns its place by being the thing
that stops a teacher losing a period of work.

**Toast** — ink background, mono uppercase kicker in marigold, plain-language
line under it. Says what happened *and its consequence*: "Attendance saved /
2 guardians notified of absence."

## Interface writing

- Buttons name the action: "Save attendance", "Record payment", "Post homework".
  Never "Submit" or "OK".
- The same word all the way through a flow. "Post homework" produces "Homework
  posted".
- Empty states are invitations: "No homework posted this week. Post the first
  one." Never "No data found".
- Errors say what happened and what to do, in the product's voice, and never
  apologise.
- Nothing is named after the schema. It's "guardians", not "contact records".

Every one of these strings is an i18n key — see rule 9 in
[CLAUDE.md](../CLAUDE.md).

## Attendance UX — the one screen to get right

Teachers do this every period. Everything else can be a little slow; this can't.

**Everyone starts present. You only tap the absentees.** In a class of 45 that's
typically three taps rather than 45. The tally updates live, the save bar sticks
to the bottom of the panel, and an unsaved stamp appears the moment anything
changes.

If this screen takes longer than the paper register, the school goes back to the
paper register and you lose the account. It's worth more of your attention than
any other view.

> Note for implementation: the exception-first *interface* does not imply
> exception-only *storage*. The API writes a record for every student in the
> session — see rule 6 in [CLAUDE.md](../CLAUDE.md).

## Accessibility floor

Visible focus rings (2.5px marigold, 2px offset) — never removed. State conveyed
by icon or text as well as colour. Real buttons with `aria-pressed`,
`aria-current` and `aria-live` on the toast. 44px tap targets on touch.
`prefers-reduced-motion` respected. Body text passes AA against paper and
against ink.
