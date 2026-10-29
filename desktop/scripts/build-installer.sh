#!/usr/bin/env bash
set -euo pipefail

# Reuse Cargo's release cache if macOS's disk-image service is temporarily busy.
# Compiler, signing, notarization and other packaging errors fail immediately.
log_file=$(mktemp)
trap 'rm -f "$log_file"' EXIT
for attempt in 1 2 3; do
  set +e
  npm exec -- tauri build --config '{"build":{"beforeBuildCommand":null},"bundle":{"createUpdaterArtifacts":false}}' --target "$TARGET" --bundles "$BUNDLES" -- --locked --bin texgo-desktop 2>&1 | tee "$log_file"
  build_status=${PIPESTATUS[0]}
  set -e
  if [ "$build_status" -eq 0 ]; then exit 0; fi
  if [ "${RUNNER_OS:-}" != macOS ] || [ "$attempt" -eq 3 ] || ! grep -Fq 'hdiutil: create failed - Resource busy' "$log_file"; then
    exit "$build_status"
  fi
  echo "macOS disk-image service is busy; retrying packaging ($attempt/2)."
  sleep "$((attempt * 5))"
done
