#!/usr/bin/env bash
set -euo pipefail

# Manage user accounts — including administrators — directly from the
# terminal, without going through the API or a browser session.
#
# This exists because every admin-granting and account-recovery action is
# deliberately absent from the HTTP API (spec: "no HTTP route that grants
# admin — promote in SQL"), and because a locked-out administrator (lost
# 2FA device, forgotten password) has no self-serve recovery path by
# design — the recovery path is this script, run by whoever already has
# shell access to the server.
#
# Requires the stack to already be running: `docker compose up -d`.
# Talks to Postgres directly via `docker compose exec postgres psql`, and
# to the `api` container only to hash a password with the same argon2id
# parameters `apps/api/src/lib/password.ts` uses — bash cannot do that
# hashing itself, and a hash produced any other way would not verify
# against what the API checks at login.
#
# Usage: ./scripts/manage-users.sh <command> [args...]
#   ./scripts/manage-users.sh help

cd "$(dirname "$0")/.."

# Not needed for the database connection — docker compose exec talks to
# the postgres container directly with its own fixed credentials — this
# is only so `sync-admin-name` and `set-admin-password` can read
# ADMIN_USERNAME.
#
# .env is in Docker Compose's format, not a shell script, so it is never
# `source`d: a value like `EMAIL_FROM=Cryptovich <no-reply@host>` is fine to
# compose and a syntax error to bash, which then refused to run any
# command at all. Only the one variable this script needs is read out.
env_file_value() {
  local name="$1" line value
  [ -f .env ] || return 0
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}=" .env | tail -n 1)" || return 0
  value="${line#*=}"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value:1:${#value}-2}" ;;
    \'*\') value="${value:1:${#value}-2}" ;;
    *)
      # Unquoted: an inline ` # comment` is not part of the value.
      value="${value%%[[:space:]]#*}"
      value="${value%"${value##*[![:space:]]}"}"
      ;;
  esac
  printf '%s' "$value"
}
# A value already in the environment wins, as it does for compose.
ADMIN_USERNAME="${ADMIN_USERNAME:-$(env_file_value ADMIN_USERNAME)}"

DB_NAME="platform"
VALID_ROLES=(USER CREATOR ADMIN MODERATOR)

# ---------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------

die() {
  echo "Error: $*" >&2
  exit 1
}

require_stack() {
  if ! docker compose exec -T postgres true >/dev/null 2>&1; then
    die "the postgres container isn't reachable — run 'docker compose up -d' first."
  fi
}

# Runs a SQL statement with psql "-v" bound parameters, which psql expands
# via :'name' as a properly quoted SQL string literal — this is what keeps
# every value below (usernames, reasons, emails an operator pastes in)
# from being interpreted as SQL, without hand-rolling escaping in bash.
# Usage: sql_exec "<sql with :'name' placeholders>" name=value [name=value ...]
#
# Every SQL helper below feeds the query to psql on stdin rather than via
# `-c`. This is not a style choice: psql's `:'name'` variable substitution
# — the thing that keeps a username or a reason string an operator pastes
# in from being interpreted as SQL — is only applied to input read from
# stdin, a script file, or the interactive prompt. A query passed via `-c`
# is sent to the server close to verbatim, so `-v name=value -c "...
# :'name' ..."` silently fails with a syntax error: the substitution
# never happens at all. Confirmed against the postgres:16 image this
# project runs before relying on it here.
sql_exec() {
  local query="$1"; shift
  local -a psql_args=(exec -T postgres psql -U postgres -d "$DB_NAME" -v "ON_ERROR_STOP=1")
  for kv in "$@"; do
    psql_args+=(-v "${kv%%=*}=${kv#*=}")
  done
  printf '%s\n' "$query" | docker compose "${psql_args[@]}"
}

# Same as sql_exec but returns exactly one unpadded field, for use in
# bash conditionals and command substitution.
sql_scalar() {
  local query="$1"; shift
  local -a psql_args=(exec -T postgres psql -U postgres -d "$DB_NAME" -v "ON_ERROR_STOP=1" -t -A)
  for kv in "$@"; do
    psql_args+=(-v "${kv%%=*}=${kv#*=}")
  done
  printf '%s\n' "$query" | docker compose "${psql_args[@]}"
}

# Same as sql_exec but in psql's expanded ("\x") display — one field per
# line instead of a wide table — for the single-row detail views.
sql_exec_x() {
  local query="$1"; shift
  local -a psql_args=(exec -T postgres psql -U postgres -d "$DB_NAME" -v "ON_ERROR_STOP=1" -x)
  for kv in "$@"; do
    psql_args+=(-v "${kv%%=*}=${kv#*=}")
  done
  printf '%s\n' "$query" | docker compose "${psql_args[@]}"
}

user_exists() {
  local username="$1"
  local n
  n="$(sql_scalar "SELECT count(*) FROM \"User\" WHERE username = :'username';" "username=$username")"
  [ "$n" = "1" ]
}

# Resolves an identifier — a current username, a user id (UUID), or a
# username the account has since been renamed away from — to the
# account's *current* username. Prints the resolved username, or the
# identifier unchanged if none of those three match anything (so the
# caller's own "no such user" error still names what was actually typed).
#
# Mirrors apps/api/src/lib/username-history.ts's resolveCurrentUsername:
# a live id or username match wins outright; UsernameHistory is only
# consulted as a fallback. This is what makes `show`/`rename`/etc. work
# with "find them by id" and "reach them by an old name" — the same
# guarantee a renamed author's bookmarked profile link gets.
resolve_username() {
  local identifier="$1" resolved

  if [[ "$identifier" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    resolved="$(sql_scalar "SELECT username FROM \"User\" WHERE id = :'id';" "id=$identifier")"
    [ -n "$resolved" ] && { printf '%s' "$resolved"; return 0; }
    printf '%s' "$identifier"
    return 0
  fi

  resolved="$(sql_scalar "SELECT username FROM \"User\" WHERE username = :'username';" "username=$identifier")"
  if [ -n "$resolved" ]; then
    printf '%s' "$resolved"
    return 0
  fi

  resolved="$(sql_scalar "
    SELECT u.username FROM \"UsernameHistory\" h
    JOIN \"User\" u ON u.id = h.\"userId\"
    WHERE h.username = :'username';
  " "username=$identifier")"
  if [ -n "$resolved" ]; then
    printf '%s' "$resolved"
    return 0
  fi

  printf '%s' "$identifier"
}

# Resolves and validates in one step: prints the current username for
# `$1` (a username, an old username, or an id) and dies if none of those
# resolve to a real account. Callers reassign their own variable from the
# printed value — `username="$(require_user "$username")"` — so every
# command downstream operates on the *current* username.
require_user() {
  local resolved
  resolved="$(resolve_username "$1")"
  user_exists "$resolved" || die "no user found matching '$1' (tried username, previous username, and id)."
  printf '%s' "$resolved"
}

validate_role() {
  local role="$1" r
  for r in "${VALID_ROLES[@]}"; do
    [ "$role" = "$r" ] && return 0
  done
  die "'$role' isn't a role. Valid roles: ${VALID_ROLES[*]}."
}

# A password strong enough to be someone's only credential, generated
# rather than asked for by default — the same reasoning apps/api/src/lib
# uses for API tokens and invite codes: a value never typed anywhere is a
# value that can't leak from being typed anywhere. Printed once, like an
# API token, because nothing here can show it again afterward.
random_password() {
  # Not `tr -dc ... < /dev/urandom | head -c 24`: head closes its read end
  # the instant it has 24 bytes, tr gets SIGPIPE writing into the closed
  # pipe, and under `set -o pipefail` that non-zero exit — even though
  # head itself succeeded — aborts the whole script. Reading a bounded
  # chunk first means every stage here drains its input and exits on its
  # own; nothing closes a pipe out from under an upstream writer.
  local out=""
  while [ "${#out}" -lt 24 ]; do
    out+="$(dd if=/dev/urandom bs=48 count=1 2>/dev/null | base64 | tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "${out:0:24}"
}

# Same minimum registration enforces (apps/api/src/modules/auth/schemas.ts).
MIN_PASSWORD_LENGTH=10

validate_password() {
  [ "${#1}" -ge "$MIN_PASSWORD_LENGTH" ] || die "the password must be at least $MIN_PASSWORD_LENGTH characters."
}

# Reads a new password from the terminal without echoing it, twice. The
# alternative, --password=P, leaves the password in shell history and in
# the process list for as long as the script runs.
prompt_password() {
  [ -t 0 ] || die "--prompt needs an interactive terminal; use --password=P or omit it to generate one."
  local first second
  read -r -s -p "New password: " first; echo >&2
  read -r -s -p "Repeat it: " second; echo >&2
  [ "$first" = "$second" ] || die "the passwords don't match."
  validate_password "$first"
  printf '%s' "$first"
}

# Hashes a password the same way the API does — argon2id, via the
# `argon2` package already installed in the running api container — so
# the result verifies against a real login. The password crosses into the
# container on stdin, not as a CLI argument, so it never appears in
# `docker compose exec`'s process listing or in shell history beyond
# whatever the caller already typed to get it into this function.
hash_password() {
  local password="$1"
  printf '%s' "$password" | docker compose exec -T -w /repo/apps/api api node -e '
    const argon2 = require("argon2");
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", async () => {
      process.stdout.write(await argon2.hash(input, { type: argon2.argon2id }));
    });
  '
}

confirm_or_skip() {
  local prompt="$1"
  if [ "${ASSUME_YES:-0}" = "1" ]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

# ---------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------

cmd_list() {
  local role_filter="" status_filter="active"
  while [ $# -gt 0 ]; do
    case "$1" in
      --role=*) role_filter="${1#*=}"; validate_role "$role_filter" ;;
      --status=*) status_filter="${1#*=}" ;;
      *) die "unknown option '$1' for list. See: $0 help" ;;
    esac
    shift
  done

  local where="WHERE 1=1"
  case "$status_filter" in
    active) where="$where AND \"deletedAt\" IS NULL AND \"suspendedAt\" IS NULL" ;;
    suspended) where="$where AND \"deletedAt\" IS NULL AND \"suspendedAt\" IS NOT NULL" ;;
    deleted) where="$where AND \"deletedAt\" IS NOT NULL" ;;
    all) : ;;
    *) die "--status must be one of active, suspended, deleted, all (got '$status_filter')." ;;
  esac
  [ -n "$role_filter" ] && where="$where AND role = :'role'"

  sql_exec "
    SELECT id,
           username,
           role,
           CASE
             WHEN \"deletedAt\" IS NOT NULL THEN 'deleted'
             WHEN \"suspendedAt\" IS NOT NULL THEN 'suspended'
             ELSE 'active'
           END AS status,
           COALESCE(email, '—') AS email,
           CASE WHEN \"twoFactorEnabled\" THEN 'on' ELSE 'off' END AS \"2fa\",
           to_char(\"createdAt\", 'YYYY-MM-DD') AS created
    FROM \"User\"
    $where
    ORDER BY \"createdAt\" DESC;
  " ${role_filter:+"role=$role_filter"}
}

cmd_show() {
  local username="${1:?Usage: $0 show <username> (accepts an id or a previous username too)}"
  username="$(require_user "$username")"
  sql_exec_x "
    SELECT u.username,
           u.id,
           u.role,
           COALESCE(u.email, '—') AS email,
           u.\"emailVerifiedAt\" IS NOT NULL AS email_verified,
           u.\"twoFactorEnabled\" AS two_factor_enabled,
           u.\"canUploadFiles\" AS can_upload_files,
           u.\"suspendedAt\" AS suspended_at,
           COALESCE(u.\"suspendedReason\", '—') AS suspended_reason,
           u.\"deletedAt\" AS deleted_at,
           u.\"createdAt\" AS created_at,
           (cp.id IS NOT NULL) AS is_creator,
           (SELECT count(*) FROM \"Session\" s
              WHERE s.\"userId\" = u.id AND s.\"revokedAt\" IS NULL AND s.\"expiresAt\" > now()) AS active_sessions,
           (SELECT count(*) FROM \"ApiToken\" t
              WHERE t.\"userId\" = u.id AND t.\"revokedAt\" IS NULL) AS active_api_tokens,
           COALESCE(
             (SELECT string_agg(h.username, ', ' ORDER BY h.\"createdAt\")
                FROM \"UsernameHistory\" h WHERE h.\"userId\" = u.id),
             '—'
           ) AS former_usernames
    FROM \"User\" u
    LEFT JOIN \"CreatorProfile\" cp ON cp.\"userId\" = u.id
    WHERE u.username = :'username';
  " "username=$username"
}

cmd_create() {
  local username="" email="" password="" role="USER"
  while [ $# -gt 0 ]; do
    case "$1" in
      --email=*) email="${1#*=}" ;;
      --password=*) password="${1#*=}"; validate_password "$password" ;;
      --prompt) password="$(prompt_password)" ;;
      --admin) role="ADMIN" ;;
      --role=*) role="${1#*=}"; validate_role "$role" ;;
      -*) die "unknown option '$1' for create. See: $0 help" ;;
      *)
        if [ -z "$username" ]; then username="$1"; else die "unexpected argument '$1'."; fi
        ;;
    esac
    shift
  done
  [ -n "$username" ] || die "Usage: $0 create <username> [--email=E] [--prompt | --password=P] [--admin | --role=ROLE]"
  [[ "$username" =~ ^[a-z0-9_]{3,32}$ ]] || die "username must be 3-32 lowercase letters, digits or underscores (matches what registration accepts)."
  user_exists "$username" && die "'$username' already exists."

  local generated=0
  if [ -z "$password" ]; then
    password="$(random_password)"
    generated=1
  fi

  local hash
  hash="$(hash_password "$password")"

  # The CreatorProfile is created alongside the account, matching what
  # registration does: every account is publishable from the start, so an
  # operator-created one must not be the odd exception that still has to
  # opt in before it can post.
  sql_exec "
    WITH new_user AS (
      INSERT INTO \"User\" (id, username, email, \"passwordHash\", role, \"emailVerifiedAt\", \"createdAt\", \"updatedAt\")
      VALUES (
        gen_random_uuid(), :'username', NULLIF(:'email', ''), :'hash', :'role',
        CASE WHEN NULLIF(:'email', '') IS NOT NULL THEN now() END,
        now(), now()
      )
      RETURNING id, username
    )
    INSERT INTO \"CreatorProfile\" (id, \"userId\", \"displayName\", \"createdAt\", \"updatedAt\")
    SELECT gen_random_uuid(), id, username, now(), now() FROM new_user;
  " "username=$username" "email=$email" "hash=$hash" "role=$role" >/dev/null

  echo "Created '$username' as $role."
  if [ "$generated" = "1" ]; then
    echo "Generated password (shown once — write it down now):"
    echo "  $password"
  fi
}

cmd_set_password() {
  local username="" password=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --password=*) password="${1#*=}"; validate_password "$password" ;;
      --prompt) password="$(prompt_password)" ;;
      -*) die "unknown option '$1' for set-password." ;;
      *)
        if [ -z "$username" ]; then username="$1"; else die "unexpected argument '$1'."; fi
        ;;
    esac
    shift
  done
  [ -n "$username" ] || die "Usage: $0 set-password <username> [--prompt | --password=P]"
  username="$(require_user "$username")"

  local generated=0
  if [ -z "$password" ]; then
    password="$(random_password)"
    generated=1
  fi

  local hash
  hash="$(hash_password "$password")"
  sql_exec "UPDATE \"User\" SET \"passwordHash\" = :'hash', \"updatedAt\" = now() WHERE username = :'username';" \
    "hash=$hash" "username=$username" >/dev/null
  # A password change invalidates every session logged in under the old
  # one, the same as the API does when a payment-relevant credential
  # changes — otherwise a stolen session outlives the reset meant to end it.
  sql_exec "UPDATE \"Session\" SET \"revokedAt\" = now() WHERE \"userId\" = (SELECT id FROM \"User\" WHERE username = :'username') AND \"revokedAt\" IS NULL;" \
    "username=$username" >/dev/null

  echo "Password updated for '$username'; every active session was signed out."
  if [ "$generated" = "1" ]; then
    echo "Generated password (shown once — write it down now):"
    echo "  $password"
  fi
}

# Which administrator a command means when none is named: the one
# ADMIN_USERNAME points at if it is an active admin, otherwise the oldest
# active admin — the account the API creates on first start.
resolve_admin() {
  local named="${1:-}"
  if [ -n "$named" ]; then
    # `|| exit`: this runs inside the caller's $(...), where set -e
    # doesn't carry over, so a failed lookup would otherwise continue.
    named="$(require_user "$named")" || exit 1
    local role
    role="$(sql_scalar "SELECT role FROM \"User\" WHERE username = :'u' AND \"deletedAt\" IS NULL;" "u=$named")"
    [ "$role" = "ADMIN" ] || die "'$named' isn't an active administrator (role: ${role:-deleted})."
    printf '%s' "$named"
    return
  fi

  if [ -n "${ADMIN_USERNAME:-}" ]; then
    local configured
    configured="$(sql_scalar "SELECT username FROM \"User\" WHERE username = :'u' AND role = 'ADMIN' AND \"deletedAt\" IS NULL;" "u=$ADMIN_USERNAME")"
    if [ -n "$configured" ]; then printf '%s' "$configured"; return; fi
  fi

  local count oldest
  count="$(sql_scalar "SELECT count(*) FROM \"User\" WHERE role = 'ADMIN' AND \"deletedAt\" IS NULL;")"
  [ "$count" != "0" ] || die "no active administrator exists. Start the API (it creates one) or run: $0 create <username> --admin"
  oldest="$(sql_scalar "SELECT username FROM \"User\" WHERE role = 'ADMIN' AND \"deletedAt\" IS NULL ORDER BY \"createdAt\" ASC LIMIT 1;")"
  if [ "$count" != "1" ]; then
    echo "Note: there are $count active administrators; using the oldest, '$oldest'. Name one to choose: $0 set-admin-password <username>" >&2
  fi
  printf '%s' "$oldest"
}

cmd_set_admin_password() {
  local username="" passthrough=()
  while [ $# -gt 0 ]; do
    case "$1" in
      -*) passthrough+=("$1") ;;
      *)
        if [ -z "$username" ]; then username="$1"; else die "unexpected argument '$1'."; fi
        ;;
    esac
    shift
  done
  username="$(resolve_admin "$username")" || exit 1
  echo "Administrator: $username"
  # Only the password changes; a lost authenticator is disable-2fa's job.
  cmd_set_password "$username" ${passthrough[@]+"${passthrough[@]}"}
}

cmd_set_role() {
  local username="${1:?Usage: $0 set-role <username> <ROLE>}"
  local role="${2:?Usage: $0 set-role <username> <ROLE>}"
  username="$(require_user "$username")"
  validate_role "$role"
  sql_exec "UPDATE \"User\" SET role = :'role', \"updatedAt\" = now() WHERE username = :'username';" \
    "role=$role" "username=$username" >/dev/null
  echo "'$username' is now $role."
}

cmd_promote() {
  local username="${1:?Usage: $0 promote <username>}"
  username="$(require_user "$username")"
  sql_exec "UPDATE \"User\" SET role = 'ADMIN', \"updatedAt\" = now() WHERE username = :'username';" "username=$username" >/dev/null
  echo "'$username' is now ADMIN."
}

cmd_demote() {
  local username="${1:?Usage: $0 demote <username> [ROLE]}"
  local role="${2:-USER}"
  validate_role "$role"
  username="$(require_user "$username")"
  sql_exec "UPDATE \"User\" SET role = :'role', \"updatedAt\" = now() WHERE username = :'username';" \
    "role=$role" "username=$username" >/dev/null
  echo "'$username' is now $role."
}

cmd_rename() {
  local old_username="${1:?Usage: $0 rename <username> <new-username>}"
  local new_username="${2:?Usage: $0 rename <username> <new-username>}"
  old_username="$(require_user "$old_username")"
  [[ "$new_username" =~ ^[a-z0-9_]{3,32}$ ]] || die "username must be 3-32 lowercase letters, digits or underscores (matches what registration accepts)."

  if [ "$old_username" = "$new_username" ]; then
    echo "'$old_username' is already named that."
    return 0
  fi

  local user_id
  user_id="$(sql_scalar "SELECT id FROM \"User\" WHERE username = :'username';" "username=$old_username")"

  # Same availability rule as registration and the API's rename path
  # (apps/api/src/lib/username-history.ts, isUsernameAvailable): a name
  # live on another account, or reserved in another account's rename
  # history, can't be taken — that is what keeps a bookmarked link from
  # ever starting to resolve to the wrong person. Reclaiming a name from
  # *this same* account's own history (reverting an earlier rename) is
  # fine and is handled below.
  local taken_by
  taken_by="$(sql_scalar "SELECT id FROM \"User\" WHERE username = :'username';" "username=$new_username")"
  [ -n "$taken_by" ] && die "'$new_username' is already someone's username."

  local reserved_by
  reserved_by="$(sql_scalar "SELECT \"userId\" FROM \"UsernameHistory\" WHERE username = :'username';" "username=$new_username")"
  if [ -n "$reserved_by" ] && [ "$reserved_by" != "$user_id" ]; then
    die "'$new_username' is reserved as a previous username of a different account."
  fi

  sql_exec "
    BEGIN;
    DELETE FROM \"UsernameHistory\" WHERE \"userId\" = :'user_id' AND username = :'new_username';
    INSERT INTO \"UsernameHistory\" (id, \"userId\", username, \"createdAt\")
      VALUES (gen_random_uuid(), :'user_id', :'old_username', now());
    UPDATE \"User\" SET username = :'new_username', \"updatedAt\" = now() WHERE id = :'user_id';
    COMMIT;
  " "user_id=$user_id" "old_username=$old_username" "new_username=$new_username" >/dev/null

  echo "'$old_username' renamed to '$new_username'."
  echo "'$old_username' stays reserved: profile and post links under the old name will keep resolving to this account (redirected to the new one), and no one else can register it."
  echo "Note: if this account has federated posts, its ActivityPub actor URI was username-based and just changed — existing remote followers won't automatically follow the renamed actor (no Move activity is implemented)."
}

cmd_sync_admin_name() {
  local desired="${ADMIN_USERNAME:-}"
  [ -n "$desired" ] || die "ADMIN_USERNAME isn't set in .env."
  [[ "$desired" =~ ^[a-z0-9_]{3,32}$ ]] || die "ADMIN_USERNAME='$desired' isn't a valid username (3-32 lowercase letters, digits or underscores)."

  local current
  current="$(sql_scalar "SELECT username FROM \"User\" WHERE role = 'ADMIN' AND \"deletedAt\" IS NULL ORDER BY \"createdAt\" ASC LIMIT 1;")"
  [ -n "$current" ] || die "no active administrator account exists to rename."

  if [ "$current" = "$desired" ]; then
    echo "Admin account '$current' already matches ADMIN_USERNAME."
    return 0
  fi

  local admin_count
  admin_count="$(sql_scalar "SELECT count(*) FROM \"User\" WHERE role = 'ADMIN' AND \"deletedAt\" IS NULL;")"
  if [ "$admin_count" != "1" ]; then
    echo "Warning: there are $admin_count active administrators; syncing the oldest one ('$current')." >&2
  fi

  cmd_rename "$current" "$desired"
}

cmd_suspend() {
  local username="" reason=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --reason=*) reason="${1#*=}" ;;
      -*) die "unknown option '$1' for suspend." ;;
      *)
        if [ -z "$username" ]; then username="$1"; else die "unexpected argument '$1'."; fi
        ;;
    esac
    shift
  done
  if [ -z "$username" ] || [ -z "$reason" ]; then
    die "Usage: $0 suspend <username> --reason=\"...\""
  fi
  username="$(require_user "$username")"
  # Unlike POST /admin/users/:id/suspend, this deliberately allows
  # suspending an administrator: that HTTP route refuses it because it is
  # reachable by any other admin over the network, and one admin
  # suspending another over HTTP is a hostile-takeover shape worth
  # blocking. A terminal script only the server operator can run is a
  # different trust boundary — sometimes suspending an admin account is
  # exactly the recovery action needed.
  sql_exec "UPDATE \"User\" SET \"suspendedAt\" = now(), \"suspendedReason\" = :'reason', \"updatedAt\" = now() WHERE username = :'username';" \
    "reason=$reason" "username=$username" >/dev/null
  sql_exec "UPDATE \"Session\" SET \"revokedAt\" = now() WHERE \"userId\" = (SELECT id FROM \"User\" WHERE username = :'username') AND \"revokedAt\" IS NULL;" \
    "username=$username" >/dev/null
  echo "'$username' suspended: $reason"
}

cmd_restore() {
  local username="${1:?Usage: $0 restore <username>}"
  username="$(require_user "$username")"
  sql_exec "UPDATE \"User\" SET \"suspendedAt\" = NULL, \"suspendedReason\" = NULL, \"updatedAt\" = now() WHERE username = :'username';" \
    "username=$username" >/dev/null
  echo "'$username' restored."
}

cmd_delete() {
  local username="" hard=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --hard) hard=1 ;;
      -*) die "unknown option '$1' for delete." ;;
      *)
        if [ -z "$username" ]; then username="$1"; else die "unexpected argument '$1'."; fi
        ;;
    esac
    shift
  done
  [ -n "$username" ] || die "Usage: $0 delete <username> [--hard]"
  username="$(require_user "$username")"

  if [ "$hard" = "1" ]; then
    confirm_or_skip "Permanently delete '$username' and everything that cascades from it (posts, comments, payments, sessions)? This cannot be undone." \
      || { echo "Cancelled."; return 0; }
    sql_exec "DELETE FROM \"User\" WHERE username = :'username';" "username=$username" >/dev/null
    echo "'$username' permanently deleted."
  else
    sql_exec "UPDATE \"User\" SET \"deletedAt\" = now(), \"updatedAt\" = now() WHERE username = :'username';" "username=$username" >/dev/null
    sql_exec "UPDATE \"Session\" SET \"revokedAt\" = now() WHERE \"userId\" = (SELECT id FROM \"User\" WHERE username = :'username') AND \"revokedAt\" IS NULL;" \
      "username=$username" >/dev/null
    echo "'$username' soft-deleted (can no longer log in; content and records untouched). Use --hard to remove permanently."
  fi
}

cmd_disable_2fa() {
  local username="${1:?Usage: $0 disable-2fa <username>}"
  username="$(require_user "$username")"
  # The lockout this command exists for: a lost authenticator device with
  # no recovery codes and no email-based reset. Clearing the secret is the only way
  # back in short of a database restore.
  sql_exec "UPDATE \"User\" SET \"twoFactorEnabled\" = false, \"twoFactorSecret\" = NULL, \"updatedAt\" = now() WHERE username = :'username';" \
    "username=$username" >/dev/null
  echo "Two-factor authentication disabled for '$username'."
}

cmd_revoke_sessions() {
  local username="${1:?Usage: $0 revoke-sessions <username>}"
  username="$(require_user "$username")"
  sql_exec "UPDATE \"Session\" SET \"revokedAt\" = now() WHERE \"userId\" = (SELECT id FROM \"User\" WHERE username = :'username') AND \"revokedAt\" IS NULL;" \
    "username=$username" >/dev/null
  echo "All active sessions for '$username' revoked."
}

cmd_grant_uploads() {
  local username="${1:?Usage: $0 grant-uploads <username>}"
  username="$(require_user "$username")"
  sql_exec "UPDATE \"User\" SET \"canUploadFiles\" = true, \"updatedAt\" = now() WHERE username = :'username';" "username=$username" >/dev/null
  echo "'$username' can now upload files to this server."
}

cmd_revoke_uploads() {
  local username="${1:?Usage: $0 revoke-uploads <username>}"
  username="$(require_user "$username")"
  sql_exec "UPDATE \"User\" SET \"canUploadFiles\" = false, \"updatedAt\" = now() WHERE username = :'username';" "username=$username" >/dev/null
  echo "'$username' can no longer upload files to this server."
}

# Federation answers "Account could not be found" for two different
# reasons — the server-wide switch is off, or the author is not enabled —
# and the 404 cannot say which. These show both and set both.
cmd_federation_status() {
  local server
  server="$(sql_scalar "SELECT value FROM \"ServerSetting\" WHERE key = 'federationEnabled';")"
  echo "Server-wide federation: ${server:-true}$([ -z "$server" ] && echo " (never set — on by default)")"
  echo
  echo "Authors:"
  sql_exec "
    SELECT u.username,
           COALESCE(f.enabled, true)                 AS federation,
           COALESCE(f.\"autoPublish\", true)        AS auto_publish,
           (f.\"actorPublicKeyPem\" IS NOT NULL)    AS has_keys,
           (SELECT count(*) FROM \"FederationFollower\" ff WHERE ff.\"creatorId\" = c.id) AS followers
    FROM \"CreatorProfile\" c
    JOIN \"User\" u ON u.id = c.\"userId\"
    LEFT JOIN \"CreatorFederationSettings\" f ON f.\"creatorId\" = c.id
    WHERE u.\"deletedAt\" IS NULL
    ORDER BY federation DESC, u.username;
  "
  if [ "${server:-true}" != "true" ]; then
    echo "Every actor answers 404 while the server-wide switch is off. Turn it on with:"
    echo "  $0 federation-enable <username>"
  fi
}

cmd_federation_enable() {
  local username="${1:-}"
  sql_exec "INSERT INTO \"ServerSetting\" (key, value, \"updatedAt\") VALUES ('federationEnabled', 'true', now())
            ON CONFLICT (key) DO UPDATE SET value = 'true', \"updatedAt\" = now();" >/dev/null
  echo "Server-wide federation: on."

  [ -n "$username" ] || { echo "(Pass a username to switch an author on as well.)"; return 0; }
  username="$(require_user "$username")" || exit 1
  # The actor keypair is minted by the API the first time the actor is
  # served, so switching an author on here is only the flag.
  sql_exec "
    INSERT INTO \"CreatorFederationSettings\" (\"creatorId\", enabled, \"autoPublish\", \"defaultVisibility\", \"createdAt\", \"updatedAt\")
    SELECT c.id, true, true, 'PUBLIC', now(), now()
    FROM \"CreatorProfile\" c JOIN \"User\" u ON u.id = c.\"userId\"
    WHERE u.username = :'username'
    ON CONFLICT (\"creatorId\") DO UPDATE SET enabled = true, \"updatedAt\" = now();
  " "username=$username" >/dev/null
  echo "Federation for '$username': on. The API picks this up within a few seconds."
}

cmd_federation_disable() {
  sql_exec "INSERT INTO \"ServerSetting\" (key, value, \"updatedAt\") VALUES ('federationEnabled', 'false', now())
            ON CONFLICT (key) DO UPDATE SET value = 'false', \"updatedAt\" = now();" >/dev/null
  echo "Server-wide federation: off. Every actor now answers 404."
}

# What was sent to whom, and what the receiving server said. A follower
# who sees nothing is otherwise a mystery; the last error names the side
# to fix. 401 means the receiver would not accept the signature — usually
# it could not fetch the actor's key through whatever sits in front of
# this site. A 2xx only means it was taken in for processing.
cmd_federation_deliveries() {
  local username="${1:-}"
  local filter="true"
  if [ -n "$username" ]; then
    username="$(require_user "$username")" || exit 1
    filter="u.username = :'username'"
  fi

  echo "Followers:"
  sql_exec "
    SELECT u.username AS author, COALESCE(ff.\"preferredUsername\" || '@' || ff.domain, ff.\"actorUri\") AS follower,
           COALESCE(ff.\"sharedInbox\", ff.inbox) AS inbox, ff.\"createdAt\"::timestamp(0) AS since
    FROM \"FederationFollower\" ff
    JOIN \"CreatorProfile\" c ON c.id = ff.\"creatorId\"
    JOIN \"User\" u ON u.id = c.\"userId\"
    WHERE $filter
    ORDER BY ff.\"createdAt\" DESC;
  " "username=$username"

  echo "Last 30 deliveries:"
  sql_exec "
    SELECT d.\"updatedAt\"::timestamp(0) AS at, d.kind, d.status,
           left(COALESCE(p.title, ''), 30) AS post, d.inbox, d.\"retryCount\" AS tries,
           d.\"nextAttemptAt\"::timestamp(0) AS next_try, d.\"lastError\" AS last_error
    FROM \"FollowerDelivery\" d
    LEFT JOIN \"DigitalProduct\" p ON p.id = d.\"productId\"
    JOIN \"CreatorProfile\" c ON c.id = COALESCE(p.\"creatorId\", d.\"creatorId\")
    JOIN \"User\" u ON u.id = c.\"userId\"
    WHERE $filter
    ORDER BY d.\"updatedAt\" DESC
    LIMIT 30;
  " "username=$username"
}

# Sends an author's recent public posts to every follower they already
# have. A new Follow does this by itself; this is for followers from
# before that existed, to retry after fixing whatever refused them, and to
# refresh posts a server already holds (as an Update) after Notes changed
# shape. Repeating is harmless.
cmd_federation_resend() {
  local username="${1:?Usage: $0 federation-resend <username>}"
  username="$(require_user "$username")" || exit 1
  local count
  count="$(sql_scalar "
    WITH author AS (
      SELECT c.id FROM \"CreatorProfile\" c JOIN \"User\" u ON u.id = c.\"userId\"
      WHERE u.username = :'username'
    ),
    posts AS (
      SELECT p.id FROM \"DigitalProduct\" p
      WHERE p.\"creatorId\" = (SELECT id FROM author)
        AND p.type = 'POST' AND p.status = 'PUBLISHED' AND p.visibility = 'PUBLIC'
        AND p.\"deletedAt\" IS NULL
        AND NOT EXISTS (SELECT 1 FROM \"ProductPrice\" pr
                        WHERE pr.\"productId\" = p.id AND pr.active AND pr.\"pricingType\" <> 'FREE')
      ORDER BY p.\"publishedAt\" DESC NULLS LAST
      LIMIT 20
    ),
    inboxes AS (
      SELECT DISTINCT COALESCE(ff.\"sharedInbox\", ff.inbox) AS inbox
      FROM \"FederationFollower\" ff WHERE ff.\"creatorId\" = (SELECT id FROM author)
    ),
    -- Each post twice: a Create for a server that does not have it yet,
    -- and 30 seconds later an Update for one that does — a server ignores
    -- a second Create, so that is how it gets the current version (with
    -- its title) of a post it already holds.
    queued AS (
      INSERT INTO \"FollowerDelivery\" (id, kind, \"productId\", inbox, status, \"retryCount\", \"nextAttemptAt\", \"createdAt\", \"updatedAt\")
      SELECT gen_random_uuid(), k.kind::\"FollowerDeliveryKind\", posts.id, inboxes.inbox, 'PENDING', 0,
             now() + k.delay, now(), now()
      FROM posts CROSS JOIN inboxes
      CROSS JOIN (VALUES ('POST', interval '0 seconds'), ('UPDATE', interval '30 seconds')) AS k(kind, delay)
      ON CONFLICT (\"productId\", inbox, kind) DO UPDATE
        SET status = 'PENDING', \"retryCount\" = 0, \"lastError\" = NULL,
            \"deliveredAt\" = NULL, \"nextAttemptAt\" = EXCLUDED.\"nextAttemptAt\", \"updatedAt\" = now()
      RETURNING 1
    )
    SELECT count(*) FROM queued;
  " "username=$username")"

  if [ "$count" = "0" ]; then
    echo "Nothing to send: '$username' has no fediverse followers, or no public free posts."
    echo "Check with: $0 federation-deliveries $username"
    return 0
  fi
  echo "Queued $count delivery(ies). The worker sends them within ~10 seconds;"
  echo "watch: docker compose logs -f worker | grep federation"
}

# Whether this server can reach the fediverse at all. Everything a remote
# server does *to* us — fetch the actor, the avatar, a post — works
# without DNS on this side, so a container that cannot resolve names
# looks healthy from outside while every Follow is rejected ("could not
# resolve the signing key") and nothing is ever delivered. This tells
# which layer is broken, from inside the api container.
FEDERATION_CHECK_JS='
const dns = require("node:dns"), net = require("node:net"), fs = require("node:fs");
const host = process.env.CHECK_HOST || "mastodon.social";
const limit = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(Object.assign(new Error("timed out"), { code: "ETIMEOUT" })), ms))]);
const line = (ok, label, detail) => console.log((ok ? "  OK    " : "  FAIL  ") + label + (detail ? " — " + detail : ""));
const why = (e) => (e && (e.code || (e.cause && e.cause.code) || e.message)) || "failed";
(async () => {
  const conf = fs.readFileSync("/etc/resolv.conf", "utf8").split("\n").filter((l) => /^(nameserver|options|search|# ?ExtServers)/.test(l));
  console.log("  /etc/resolv.conf: " + (conf.join(" | ") || "(empty)"));
  const connect = (ip) => limit(new Promise((ok, fail) => { const s = net.connect(443, ip, () => { s.destroy(); ok(); }); s.on("error", fail); }), 5000);
  const tcp = await Promise.any(["1.1.1.1", "8.8.8.8"].map(connect))
    .then(() => (line(true, "internet by IP (1.1.1.1 or 8.8.8.8, port 443)"), true), (e) => (line(false, "internet by IP (1.1.1.1 or 8.8.8.8, port 443)", why(e.errors && e.errors[0])), false));
  const sys = await limit(dns.promises.lookup(host), 8000)
    .then((a) => (line(true, "container DNS: " + host, a.address), true), (e) => (line(false, "container DNS: " + host, why(e)), false));
  // Each public resolver on its own: one of them may be blocked where the
  // others are not, and the override should name only those that answer.
  const answering = [];
  for (const server of ["1.1.1.1", "8.8.8.8", "77.88.8.8"]) {
    const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([server]);
    await limit(resolver.resolve4(host), 5000)
      .then((a) => { answering.push(server); line(true, "DNS server " + server + ": " + host, a[0]); }, (e) => line(false, "DNS server " + server + ": " + host, why(e)));
  }
  const pub = answering.length > 0;
  const web = sys && (await fetch("https://" + host + "/.well-known/nodeinfo", { signal: AbortSignal.timeout(10000) })
    .then((r) => (line(r.ok, "HTTPS to " + host, "HTTP " + r.status), r.ok), (e) => (line(false, "HTTPS to " + host, why(e)), false)));
  console.log("");
  console.log("RESOLVERS " + answering.join(" "));
  if (sys && web) console.log("VERDICT ok");
  else if (!tcp) console.log("VERDICT no-internet");
  else if (!sys && pub) console.log("VERDICT docker-dns");
  else if (!sys) console.log("VERDICT dns-blocked");
  else console.log("VERDICT https");
  // A connection attempt that never answered is still open; do not wait
  // for the kernel to give up on it.
  process.exit(0);
})();
'

# docker-compose.override.yml giving api and worker the named resolvers.
dns_override() {
  local joined="$*"
  local list="${joined// /, }"
  printf 'services:\n  api:\n    dns: [%s]\n  worker:\n    dns: [%s]\n' "$list" "$list"
}

# Reaches 1.1.1.1 / 8.8.8.8 on 443 by address: no DNS involved.
TCP_OUT_JS='
const net = require("node:net");
const tryOne = (ip) => new Promise((ok, fail) => {
  const s = net.connect(443, ip, () => { s.destroy(); ok(); });
  s.on("error", fail);
  setTimeout(() => { s.destroy(); fail(new Error("timeout")); }, 5000);
});
Promise.any([tryOne("1.1.1.1"), tryOne("8.8.8.8")]).then(() => { console.log("yes"); process.exit(0); }, () => { console.log("no"); process.exit(0); });
'

# Why a container cannot get out, from the host's side: the same image run
# on Docker's default bridge and on the host's own network tells a Docker
# NAT/forwarding problem from a host with no way out at all, and the
# settings that usually cause the first are printed alongside.
host_network_facts() {
  local container image net subnet on_bridge on_host forward masq="unknown (run as root to see)"
  local rules routes
  container="$(docker compose ps -q api)"
  image="$(docker inspect -f '{{.Image}}' "$container")"
  net="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$container" | awk '{print $1}' || true)"
  subnet="$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$net" 2>/dev/null | awk '{print $1}' || true)"

  on_bridge="$(printf '%s' "$TCP_OUT_JS" | docker run --rm -i --network bridge --entrypoint node "$image" - 2>/dev/null || echo "could not run")"
  on_host="$(printf '%s' "$TCP_OUT_JS" | docker run --rm -i --network host --entrypoint node "$image" - 2>/dev/null || echo "could not run")"
  forward="$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null || echo "?")"

  # Read whole, then counted: `grep -q` quitting early SIGPIPEs the writer,
  # which pipefail reports as a failed match.
  if [ -n "$subnet" ] && [ "$(id -u)" = "0" ]; then
    rules="$({ iptables -t nat -S POSTROUTING 2>/dev/null || true; nft list ruleset 2>/dev/null || true; })"
    if [ "$(grep -F "$subnet" <<<"$rules" | grep -ci masquerade || true)" -gt 0 ]; then
      masq="present"
    else
      masq="MISSING"
    fi
  fi

  echo "  project network $net ($subnet): NAT rule $masq"
  echo "  net.ipv4.ip_forward = $forward"
  echo "  internet from a container on Docker's default bridge: $on_bridge"
  echo "  internet from the host's own network:                 $on_host"
  if [ -r /etc/docker/daemon.json ]; then
    echo "  /etc/docker/daemon.json: $(tr -s ' \n\t' ' ' < /etc/docker/daemon.json)"
  else
    echo "  /etc/docker/daemon.json: (none)"
  fi
  routes="$(ip route show table 52 2>/dev/null || true)"
  if [ "$(grep -c '^default' <<<"$routes" || true)" -gt 0 ]; then
    echo "  Tailscale exit node: IN USE — all of the host's traffic leaves through it"
  fi
  echo

  if [ "$on_host" = "no" ]; then
    echo "The host itself cannot reach the internet on port 443 by address, so no"
    echo "container can either. Something on the host sends traffic nowhere: a"
    echo "Tailscale exit node that does not forward, or an outbound firewall. Check"
    echo "with: curl -sS -m 5 -o /dev/null -w '%{http_code}\\n' https://1.1.1.1"
  elif grep -qE '"iptables"[[:space:]]*:[[:space:]]*false' /etc/docker/daemon.json 2>/dev/null; then
    local exposed
    exposed="$(docker ps --format '{{.Names}}  {{.Ports}}' | grep -E '0\.0\.0\.0:|\[::\]:' || true)"
    echo "\"iptables\": false in /etc/docker/daemon.json — Docker sets up no NAT, so no"
    echo "container gets out. Restarting Docker alone changes nothing; one of:"
    echo
    echo "A) Let Docker manage NAT: delete the \"iptables\" and \"ip6tables\" lines from"
    echo "   /etc/docker/daemon.json, then"
    echo "     sudo systemctl restart docker && docker compose up -d"
    echo "   Docker then opens the ports it publishes on all interfaces past ufw."
    if [ -n "$exposed" ]; then
      echo "   On this host that is (every container, not only this project):"
      printf '%s\n' "$exposed" | sed 's/^/     /'
      echo "   Bind any that should stay private to 127.0.0.1 before choosing A."
    else
      echo "   No container here publishes on all interfaces, so nothing new opens."
    fi
    echo
    echo "B) Keep \"iptables\": false and give ufw the NAT rule instead. Add at the very"
    echo "   top of /etc/ufw/before.rules:"
    echo "     *nat"
    echo "     :POSTROUTING ACCEPT [0:0]"
    echo "     -A POSTROUTING -s 172.16.0.0/12 ! -d 172.16.0.0/12 -j MASQUERADE"
    echo "     COMMIT"
    echo "   then:"
    echo "     sudo ufw route allow from 172.16.0.0/12"
    echo "     sudo ufw reload"
  elif [ "$forward" = "0" ]; then
    echo "IP forwarding is off, so the host does not pass container traffic on. Fix:"
    echo "  echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-docker-forward.conf"
    echo "  sudo sysctl --system && sudo systemctl restart docker"
  elif [ "$masq" = "MISSING" ] || [ "$on_bridge" = "no" ]; then
    echo "Docker's NAT/forwarding rules are gone — usually a firewall reload (ufw,"
    echo "firewalld, an iptables-restore) wiped them after Docker started. Restarting"
    echo "Docker puts them back:"
    echo "  sudo systemctl restart docker && docker compose up -d"
    echo "If it comes back after the next firewall reload, that firewall has to allow"
    echo "forwarding from Docker networks (ufw: DEFAULT_FORWARD_POLICY=\"ACCEPT\" in"
    echo "/etc/default/ufw, or: sudo ufw route allow from 172.16.0.0/12)."
  else
    echo "The default bridge gets out but this project's network does not: something"
    echo "filters that one network. Recreating it often clears it:"
    echo "  docker compose down && docker compose up -d"
  fi
}

cmd_federation_check() {
  local fix_dns=false
  [ "${1:-}" = "--fix-dns" ] && fix_dns=true
  docker compose exec -T api true >/dev/null 2>&1 || die "the api container isn't running — run 'docker compose up -d' first."

  echo "Outbound network, from inside the api container (the worker shares it):"
  local output verdict resolvers override
  output="$(printf '%s' "$FEDERATION_CHECK_JS" | docker compose exec -T api node -)"
  printf '%s\n' "$output" | grep -vE '^(VERDICT|RESOLVERS)'
  verdict="$(printf '%s\n' "$output" | sed -n 's/^VERDICT //p')"
  resolvers="$(printf '%s\n' "$output" | sed -n 's/^RESOLVERS //p')"

  case "$verdict" in
    ok)
      echo "Outbound federation works. If a follow still hangs, look at:"
      echo "  docker compose logs --since 1h api | grep -i inbox"
      ;;
    docker-dns)
      echo "Docker's DNS does not answer, but public resolvers do. Give the containers"
      echo "their own resolvers with docker-compose.override.yml (compose reads it"
      echo "automatically):"
      echo
      override="$(dns_override $resolvers)"
      printf '%s\n' "$override" | sed 's/^/    /'
      echo
      if $fix_dns; then
        if [ -e docker-compose.override.yml ]; then
          echo "docker-compose.override.yml already exists — add the lines above to it by hand."
        else
          printf '%s\n' "$override" > docker-compose.override.yml
          echo "Written. Apply with: docker compose up -d api worker"
        fi
      else
        echo "Or let this script write it: $0 federation-check --fix-dns"
      fi
      echo "Then run this check again."
      ;;
    dns-blocked)
      echo "Names do not resolve, even through public resolvers: DNS (port 53) is"
      echo "blocked for containers. Either allow outbound UDP/TCP 53, or put the"
      echo "resolver the host itself uses (resolvectl status, or /etc/resolv.conf on"
      echo "the host) into docker-compose.override.yml as 'dns:' for api and worker."
      ;;
    no-internet)
      echo "The container has no route out at all — not even to an IP address, so this"
      echo "is not DNS. Looking at the host:"
      echo
      host_network_facts
      ;;
    *)
      echo "Names resolve but HTTPS does not get through — a firewall or proxy on the"
      echo "way out. Remote servers can reach this one, but it cannot answer them."
      ;;
  esac
}

cmd_help() {
  cat <<'EOF'
Manage user accounts — including administrators — from the terminal.

Usage: ./scripts/manage-users.sh <command> [args...]

  list [--role=ROLE] [--status=active|suspended|deleted|all]
                                    List accounts (with id). Default: active, any role.
  show <username>                  Full detail: id, role, 2FA, sessions, tokens, creator
                                    status, former usernames. <username> also accepts a
                                    user id or a name the account has renamed away from.
  rename <username> <new-username> Rename an account. The old name stays reserved to
                                    this account forever — a bookmarked profile or post
                                    link under it keeps resolving (redirected) to the
                                    new name, and no one else can register it. Renaming
                                    back to a name this account held before is just a
                                    normal rename. <username> accepts an id or a
                                    previous username too, so a renamed account is never
                                    unreachable. Warns about the ActivityPub caveat: a
                                    federated actor's URI is username-based, so remote
                                    followers don't automatically follow a renamed actor.
  sync-admin-name                  Rename the (oldest) active administrator to match
                                    ADMIN_USERNAME in .env, if it doesn't already. A
                                    deliberate, explicitly-run action — nothing renames
                                    an admin automatically.
  create <username> [--email=E] [--prompt | --password=P] [--admin | --role=ROLE]
                                    Create an account directly — no invite code needed.
                                    Omit --password to get a generated one, shown once.
  set-password <username> [--prompt | --password=P]
                                    Reset a password and sign the account out everywhere.
                                    --prompt asks for it without echoing (nothing lands in
                                    shell history); omit both to get a generated one,
                                    shown once.
  set-admin-password [<username>] [--prompt | --password=P]
                                    The same, for the administrator: ADMIN_USERNAME if it
                                    is an active admin, otherwise the oldest one. Name an
                                    admin to pick a specific one.
  set-role <username> <ROLE>       ROLE is one of USER, CREATOR, MODERATOR, ADMIN.
  promote <username>               Shortcut for: set-role <username> ADMIN
  demote <username> [ROLE]         Shortcut for: set-role <username> ${ROLE:-USER}
  suspend <username> --reason="…"  Block login, keep content. Works on admins too —
                                    the API refuses that over HTTP on purpose; this
                                    script runs at a different trust level.
  restore <username>               Reverse a suspension.
  delete <username> [--hard]       Soft-delete by default (blocks login, keeps records).
                                    --hard permanently deletes the account and everything
                                    that cascades from it. Asks to confirm unless ASSUME_YES=1.
  disable-2fa <username>           Clear a lost authenticator's 2FA. This is the
                                    lockout-recovery command: no email is ever sent,
                                    so this is the only way back in. An administrator
                                    is shown a new QR code at their next sign-in.
  revoke-sessions <username>       Force-logout everywhere without touching the password.
  grant-uploads <username>         Allow server-side file uploads for posts.
  revoke-uploads <username>        Withdraw it.
  federation-status                Server-wide federation switch, and which authors
                                    are federated, with their follower counts.
  federation-enable [<username>]   Turn federation on for the server, and for that
                                    author too if one is named.
  federation-disable               Turn federation off for the whole server.
  federation-check [--fix-dns]     Can this server reach the fediverse? Tests the
                                    api container's internet, DNS and HTTPS, names the
                                    broken layer and the fix. --fix-dns writes the
                                    DNS override when that is the problem.
  federation-deliveries [<username>]
                                    Fediverse followers, and the last 30 posts/profile
                                    updates sent to them with what their server answered.
  federation-resend <username>     Send the author's 20 latest public posts to every
                                    follower again (for followers from before new
                                    followers got them automatically, or after a fix).
  help                             This message.

Environment:
  ASSUME_YES=1   Skip the confirmation prompt on --hard delete (for scripting).

Requires the stack running (docker compose up -d). Talks to Postgres
directly and to the api container only to hash passwords with the same
argon2id parameters the API itself uses.
EOF
}

# ---------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------

[ $# -ge 1 ] || { cmd_help; exit 1; }
command="$1"; shift

case "$command" in
  help|-h|--help) cmd_help ;;
  list) require_stack; cmd_list "$@" ;;
  show) require_stack; cmd_show "$@" ;;
  rename) require_stack; cmd_rename "$@" ;;
  sync-admin-name) require_stack; cmd_sync_admin_name "$@" ;;
  create) require_stack; cmd_create "$@" ;;
  set-password) require_stack; cmd_set_password "$@" ;;
  set-admin-password) require_stack; cmd_set_admin_password "$@" ;;
  federation-status) require_stack; cmd_federation_status "$@" ;;
  federation-enable) require_stack; cmd_federation_enable "$@" ;;
  federation-disable) require_stack; cmd_federation_disable "$@" ;;
  federation-check) cmd_federation_check "$@" ;;
  federation-deliveries) require_stack; cmd_federation_deliveries "$@" ;;
  federation-resend) require_stack; cmd_federation_resend "$@" ;;
  set-role) require_stack; cmd_set_role "$@" ;;
  promote) require_stack; cmd_promote "$@" ;;
  demote) require_stack; cmd_demote "$@" ;;
  suspend) require_stack; cmd_suspend "$@" ;;
  restore) require_stack; cmd_restore "$@" ;;
  delete) require_stack; cmd_delete "$@" ;;
  disable-2fa) require_stack; cmd_disable_2fa "$@" ;;
  revoke-sessions) require_stack; cmd_revoke_sessions "$@" ;;
  grant-uploads) require_stack; cmd_grant_uploads "$@" ;;
  revoke-uploads) require_stack; cmd_revoke_uploads "$@" ;;
  *) die "unknown command '$command'. Run '$0 help' for usage." ;;
esac
