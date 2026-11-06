# Onboarding and What's new

Two cards, two audiences, and neither waits for a restart. A **fresh install** gets the onboarding tour. Someone who **updates** gets a short What's new note for the release, once. Nobody gets both, and a fresh install is never shown a changelog. The design follows the playbook ("Settings tabs and telling users what changed", section 5); this page is the repo's own spec and the source for a later playbook update.

## State (all per device, in `data.json`)

| Key | Meaning |
|---|---|
| `onboardingSeen` | The tour has been shown, or is not owed |
| `lastSeenVersion` | Newest release this device has been told about (`""` until the plugin first runs) |
| `showWhatsNew` | The person's switch (Settings → Help), default on |

Obsidian Sync can carry `data.json` to other devices, so "per device" is a hope, not a guarantee. The worst case is a popup skipped on a second device. A `lastSeenVersion` newer than the running version is ignored (comparison only).

## Who is who (decided once per load, `reconcileInstall`)

| Situation | What happens |
|---|---|
| No saved data (fresh install) | `lastSeenVersion` is set to the running version, so no What's new. The tour is owed. |
| Saved data without a `lastSeenVersion` key (updated from before this existed) | `onboardingSeen` becomes true: the tour is never pushed at them. `lastSeenVersion` stays empty, so they get a catch-up What's new. |
| Anything else | Nothing at load. |

## When something is shown (`maybeShowStartupCard`)

About a second and a half after `onLayoutReady` (Obsidian runs that at once when the plugin is switched on in a running session), never while writes are paused:

1. Tour owed (`onboardingSeen` false): show the tour; closing it sets `onboardingSeen` and `lastSeenVersion`. No What's new meanwhile.
2. Otherwise, with `showWhatsNew` on and notes newer than `lastSeenVersion` and not newer than the running version: record `lastSeenVersion`, wait for the save, then open the popup.

There is no "real start" test and no restart notice. If this code is running, this version is the one that is loaded, and its commands, settings group and views were registered by this same `onload`; a file swap that left old code running cannot run this code at all. The delay is only so the card does not open under the settings window that switched the plugin on. Unverified until a device confirms it: that a BRAT update reloads the plugin so this `onload` runs (otherwise nothing shows until the plugin is next toggled or Obsidian restarts).

A beta counts as its stable version (`0.1.2-beta.9` is `0.1.2`): a tester sees the note once, on the first beta that has it. To see it again on a device: Settings → Help → turn **Show what's new after updates** off and on (this clears `lastSeenVersion`), then restart.

Manual ways in: commands **Show onboarding card** and **Show what's new** (the whole running minor line), and the two buttons under Settings → Help.

## Writing the note

`src/whatsNew/releaseNotes.ts`, newest first, versions plain `X.Y.Z` (the release gate reads them with a regex).

- Every change a person can see or must relearn adds an item to the entry for the **next base version** in the same PR. Create the entry if it does not exist.
- Keep items short and benefit-led; longer text belongs in the README. Backticks show as code. A `figure` is drawn from real interface elements (`src/onboardingFigures.ts`), never a screenshot.
- Notes stack within a minor line: never delete an entry of the line you are in. `npm run check-release` fails if one is missing compared with the latest stable tag, and warns when a minor release has no entry.
- `CHANGELOG.md` stays the full human log; the popup is the short version.

## Changing the tour

`src/onboarding.ts`: at most 15 cards (a test pins it), short texts (under 400 characters), every figure id has a builder and is used. A new card needs a layout scene (`scripts/check-layout.mjs`, `Onboarding1`..`OnboardingN`).

## Testing

Automated: `src/tests/whatsNew.test.ts` (version logic), `src/tests/whatsNewFlow.dom.test.ts` (fresh, updated, skipped, running session, switched off, paused, stacked, commands), layout scenes `Onboarding1`..`Onboarding12` and `WhatsNew`.

Manual, on a device: install the beta over an older one and restart (popup once, not on the second restart); a BRAT update inside a running session shows the note after a moment, without a restart (if it does not, that is the unverified assumption above); a fresh vault, or enabling the plugin in a running Obsidian, shows the tour and no note; remove the plugin folder's `data.json` to repeat.
