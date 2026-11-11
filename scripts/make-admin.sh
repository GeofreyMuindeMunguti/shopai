#!/usr/bin/env bash
# Promotes an existing user to admin by setting app_metadata.role = 'admin'.
# There is deliberately no UI/API path for this (ADR-0007): it runs SQL directly
# against the local Supabase DB container. The user must sign in again (or
# refresh their session) for the new JWT claim to apply.
#
# Usage: scripts/make-admin.sh jane@example.com
set -euo pipefail

email="${1:-}"
if [ -z "$email" ]; then
  echo "usage: $0 <email>" >&2
  exit 1
fi

project_id="$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$(dirname "$0")/../supabase/config.toml")"
container="supabase_db_${project_id}"

result="$(docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA \
  -v email="$email" <<'SQL'
select promote_admin(:'email');
select count(*) from auth.users where lower(email) = lower(:'email') and raw_app_meta_data ->> 'role' = 'admin';
SQL
)"

if [ "$(printf '%s\n' "$result" | tail -n1)" = "1" ]; then
  echo "make-admin: $email is now an admin (sign out and back in to refresh the session)"
else
  echo "make-admin: no user with email $email -- sign in once first" >&2
  exit 1
fi
