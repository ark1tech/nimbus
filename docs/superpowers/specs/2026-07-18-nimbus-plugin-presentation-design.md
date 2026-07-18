# Nimbus Plugin Presentation Design

## Goal

Make the Nimbus plugin detail page feel complete and immediately usable in Codex. The page must show
the existing Nimbus identity and three realistic product-development prompts, matching the presentation
behavior demonstrated by the bundled Documents plugin.

## Manifest presentation

Update `.codex-plugin/plugin.json` without changing Nimbus workflow behavior:

- Use `./assets/nimbus_logo.png` for both `interface.logo` and `interface.composerIcon`.
- Add a purple `interface.brandColor` that complements the existing Nimbus logo.
- Change `interface.defaultPrompt` from one string to exactly these three strings:
  1. `$nimbus Add server-side sessions so users stay signed in across browser restarts and can revoke other devices.`
  2. `$nimbus Add role-based access control so admins manage teammates while members only access assigned projects.`
  3. `$nimbus Add a searchable activity feed with filters for actor, action, project, and date.`
- Add `interface.screenshots` as an empty array. Codex generates the prompt presentation from the
  brand color and starter prompts; Nimbus does not need a decorative screenshot asset.

Each prompt must retain the explicit `$nimbus` trigger required by the Nimbus Work Item skill and remain
within Codex's 128-character starter-prompt limit.

## Validation

Extend `scripts/validate-plugin.mjs` so packaging fails when:

- the logo or composer icon does not reference the existing Nimbus logo;
- the brand color is missing or malformed;
- the prompt collection does not contain exactly three non-empty strings;
- a prompt exceeds 128 characters or omits the `$nimbus` trigger; or
- the manifest refers to a presentation asset that is absent from the plugin archive.

Run the repository tests, production build, plugin validator, and bundled MCP smoke after the metadata
change. The MCP and workflow behavior must remain unchanged.

## Installation and verification

Use the plugin-creator cachebuster helper for the existing local plugin, then reinstall
`nimbus@personal`. Verify the installed cache contains the logo and updated manifest. A newly started
Codex task is the acceptance boundary for refreshed plugin metadata and tools.

## Out of scope

- Replacing or redesigning the Nimbus logo.
- Adding custom screenshots or a bespoke plugin-detail application.
- Changing the Nimbus Work Item workflow, MCP tools, or browser control plane.
