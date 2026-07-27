#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"
EXPECTED_SHA="${2:-}"

if [[ -z "${TAG}" || -z "${EXPECTED_SHA}" ]]; then
  echo "Usage: bash scripts/verify_release_tag_target.sh TAG EXPECTED_SHA" >&2
  exit 2
fi

TAG_REF="refs/tags/${TAG}"
if ! git rev-parse -q --verify "${TAG_REF}" >/dev/null; then
  echo "::error::Release tag ${TAG} does not exist." >&2
  exit 2
fi

# ^{} dereferences annotated tags while leaving lightweight commit tags intact.
EXISTING_TAG_SHA="$(git rev-parse "${TAG_REF}^{}")"
if [[ "${EXISTING_TAG_SHA}" != "${EXPECTED_SHA}" ]]; then
  echo \
    "::error::Release tag ${TAG} resolves to ${EXISTING_TAG_SHA}, not current commit ${EXPECTED_SHA}." \
    >&2
  exit 1
fi

echo "Release tag ${TAG} already points to current commit ${EXPECTED_SHA}."
