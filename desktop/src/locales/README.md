# Interface translations

`zh-CN/` and `en-US/` contain matching JSON files grouped by interface domain.
Keep both the domain and message keys identical across languages. Use `t()` from
`src/i18n.ts`; components that render translations must subscribe through
`useLocale()` or a parent that does so. Do not translate filenames, source text,
IPC identifiers or fingerprints.

Use named placeholders for dynamic values. English count messages support ICU
plurals (`{count, plural, one {# image} other {# images}}`). Chinese messages use
simple placeholders. Both languages must declare the same parameters. English
resources and the ICU formatter load only when English is selected.

`native.json` also supplies desktop menus, notifications and known backend
diagnostics. `native-parameters.json` identifies nested error parameters that may
be translated recursively; paths must never be included in that metadata.
Backend protocol messages remain stable and are translated only for display.
Unknown operating-system diagnostics are retained verbatim.

Settings persists the chosen language in native preferences. Add new languages
to the locale type, resource loader, preference validation and language selector
together.

Before committing, run `npm run check:i18n`, `npm run check` and the focused
localization/workflow tests from `desktop/`. The catalog check validates language
parity, placeholders, English plurals and untranslated interface strings.
