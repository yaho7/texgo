# Contributing

Texgo uses Node.js 22, npm, Rust and the native Tauri development prerequisites.
Start with [local setup](docs/development.md), including the generated icon and
bundled-engine steps before running desktop-feature tests.

```sh
cd desktop
npm ci
npm run check
npm run check:i18n
npm test
npm run test:pdf
npm run test:release
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --features automation
# After preparing native resources:
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Keep changes focused. Use existing formatting and typed frontend models; keep Rust
responsible for file ownership, fingerprints, transactions and recovery. Put UI
strings in the [independent language files](desktop/src/locales/README.md).

Background monitoring and Smart Convert must never edit `.tex`. Reference changes
need an explicit review and fresh fingerprint validation at application time.
Preserve Undo, the Journal and project-root boundaries. Keep binaries, generated
icons, build output and credentials out of Git.

Run checks relevant to your change, inspect the diff, and commit one coherent
feature or fix at a time. Use conventional messages such as `fix: reject changed
reference targets` or `docs: clarify project setup`. Preserve unrelated local work.

A pull request should state the problem, resulting behavior and verification.
Include before/after screenshots for UI changes and state which platforms you
actually tested. Do not claim installed-app acceptance from mocked browser tests.
Release publication requires an exact version tag and the release workflow;
ordinary branch pushes produce artifacts only.
