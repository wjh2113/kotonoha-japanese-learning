#!/usr/bin/env bash
# Download the latest (or given) GitHub Actions APK into artifacts/kotonoha-debug.apk
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/artifacts"
mkdir -p "$DEST"

RUN_ID="${1:-}"
if [[ -z "$RUN_ID" ]]; then
  RUN_ID="$(gh run list --workflow=android-apk.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
fi
if [[ -z "$RUN_ID" ]]; then
  echo "No android-apk workflow run found." >&2
  exit 1
fi

echo "==> Waiting for Android APK run ${RUN_ID}"
gh run watch "$RUN_ID" --exit-status

ART_ID="$(gh api "repos/{owner}/{repo}/actions/runs/${RUN_ID}/artifacts" --jq '.artifacts[] | select(.name=="kotonoha-android-apk" and .expired==false) | .id' | head -n1)"
if [[ -z "$ART_ID" ]]; then
  echo "Run ${RUN_ID} has no kotonoha-android-apk artifact." >&2
  exit 1
fi

ZIP="$DEST/kotonoha-android-apk.zip"
echo "==> Downloading artifact ${ART_ID}"
gh api -H "Accept: application/vnd.github+json" "repos/{owner}/{repo}/actions/artifacts/${ART_ID}/zip" > "$ZIP"
unzip -o "$ZIP" -d "$DEST"
rm -f "$ZIP"
test -f "$DEST/kotonoha-debug.apk"
ls -lh "$DEST/kotonoha-debug.apk"
if command -v open >/dev/null 2>&1; then
  open -R "$DEST/kotonoha-debug.apk"
fi
echo "$DEST/kotonoha-debug.apk"
