#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi

checksum_file() {
  local file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{ print $1 }'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{ print $1 }'
    return
  fi

  echo "No SHA-256 checksum tool found" >&2
  exit 1
}

extract_created_tables() {
  local file="$1"
  sed -n 's/^CREATE TABLE "\(.*\)" (.*/\1/p' "$file"
}

all_tables_exist() {
  local missing=0
  local table_name

  while IFS= read -r table_name; do
    [[ -z "$table_name" ]] && continue

    if ! psql "$DATABASE_URL" \
      --tuples-only \
      --no-align \
      --quiet \
      --set ON_ERROR_STOP=1 \
      --set table_name="$table_name" <<'SQL' | grep -qx 't'
SELECT to_regclass(format('public.%s', :'table_name')) IS NOT NULL;
SQL
    then
      missing=1
      break
    fi
  done < <(extract_created_tables "$1")

  [[ "$missing" -eq 0 ]]
}

record_migration() {
  local filename="$1"
  local checksum="$2"

  psql "$DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --set filename="$filename" \
    --set checksum="$checksum" <<'SQL'
INSERT INTO schema_migrations (filename, checksum)
VALUES (:'filename', :'checksum');
SQL
}

mapfile -t migration_files < <(find drizzle -maxdepth 1 -type f -name '*.sql' | sort)

if [[ "${#migration_files[@]}" -eq 0 ]]; then
  echo "No SQL migrations found under drizzle/."
  exit 0
fi

echo "Preparing database extensions and migration tracking..."
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamp DEFAULT now() NOT NULL
);
SQL

for migration in "${migration_files[@]}"; do
  filename="$(basename "$migration")"
  checksum="$(checksum_file "$migration")"
  existing_migration_count="$(
    psql "$DATABASE_URL" \
      --tuples-only \
      --no-align \
      --quiet \
      --set ON_ERROR_STOP=1 <<'SQL'
SELECT COUNT(*) FROM schema_migrations;
SQL
  )"
  applied_checksum="$(
    psql "$DATABASE_URL" \
      --tuples-only \
      --no-align \
      --quiet \
      --set ON_ERROR_STOP=1 \
      --set filename="$filename" <<'SQL'
SELECT checksum
FROM schema_migrations
WHERE filename = :'filename';
SQL
  )"

  if [[ -n "$applied_checksum" ]]; then
    if [[ "$applied_checksum" != "$checksum" ]]; then
      echo "Migration checksum mismatch for $filename" >&2
      exit 1
    fi

    echo "Skipping already applied migration: $filename"
    continue
  fi

  if [[ "$existing_migration_count" == "0" ]] && all_tables_exist "$migration"; then
    echo "Baselining existing schema for migration: $filename"
    record_migration "$filename" "$checksum"
    continue
  fi

  echo "Applying migration: $filename"
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file "$migration"

  record_migration "$filename" "$checksum"
done

echo "Migrations complete."
