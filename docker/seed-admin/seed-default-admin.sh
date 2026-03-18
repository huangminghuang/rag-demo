#!/usr/bin/env bash

set -euo pipefail

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

admin_email="$(trim "$(printf '%s' "${DEFAULT_ADMIN_EMAIL:-}" | tr '[:upper:]' '[:lower:]')")"
admin_name="$(trim "${DEFAULT_ADMIN_NAME:-Default Admin}")"

if [[ -z "$admin_email" ]]; then
  echo "Skipping admin seed: DEFAULT_ADMIN_EMAIL is not set."
  exit 0
fi

psql "$DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --set admin_email="$admin_email" \
  --set admin_name="$admin_name" <<'SQL'
INSERT INTO users (email, name, role, updated_at)
VALUES (:'admin_email', :'admin_name', 'admin', NOW())
ON CONFLICT (email) DO UPDATE
SET
  role = 'admin',
  name = EXCLUDED.name,
  updated_at = NOW()
RETURNING email, role;
SQL

echo "Default admin ready: ${admin_email} (admin)"
