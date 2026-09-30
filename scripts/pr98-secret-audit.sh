#!/usr/bin/env bash
set -euo pipefail
actual_sha="$(git rev-parse HEAD)"
if [ -n "${CANDIDATE_SHA:-}" ]; then test "$actual_sha" = "$CANDIDATE_SHA"; fi
scan_root="$(mktemp -d)"
trap 'rm -rf "$scan_root"' EXIT
mkdir "$scan_root/tools" "$scan_root/source"
base=https://github.com/gitleaks/gitleaks/releases/download/v8.30.1
curl -fsSL "$base/gitleaks_8.30.1_checksums.txt" -o "$scan_root/tools/checksums.txt"
curl -fsSL "$base/gitleaks_8.30.1_linux_x64.tar.gz" -o "$scan_root/tools/gitleaks_8.30.1_linux_x64.tar.gz"
(cd "$scan_root/tools" && awk '$2 == "gitleaks_8.30.1_linux_x64.tar.gz"' checksums.txt | sha256sum -c -)
tar -xzf "$scan_root/tools/gitleaks_8.30.1_linux_x64.tar.gz" -C "$scan_root/tools" gitleaks
git archive HEAD | tar -xf - -C "$scan_root/source"
"$scan_root/tools/gitleaks" dir "$scan_root/source" --config "$scan_root/source/.gitleaks.toml" --redact=100 --no-banner --log-level warn --ignore-gitleaks-allow
echo "SECRET_SCAN=PASS TOOL=gitleaks/8.30.1 FINDINGS=0 SOURCE_SHA=$actual_sha"
