#!/usr/bin/env bash
set -euo pipefail

# Upgrade Cryptovich after copying a new version over this folder. Run it from
# anywhere; it works in the folder it lives in.
#
#   ./scripts/upgrade.sh                 build, switch, check
#   ./scripts/upgrade.sh --maintenance   show the "updating" page to everyone
#                                        for the whole switch (long migrations)
#   ./scripts/upgrade.sh --no-cache      build from scratch (slower)
#   ./scripts/upgrade.sh --dry-run       print what it would do, do nothing
#
# A release zip (scripts/make-release.sh) is unpacked here first:
#   unzip -o ~/cryptovich-<version>.zip && ./scripts/upgrade.sh
# Its list of files (.release-files) is compared with the previous
# release's, and what the new version no longer has is removed before the
# build — the server's own files (.env, branding, uploads) are never on a
# list, so they are never touched.
#
# The first run also puts the gate (deploy/gate) in front, for good: it
# takes the port the site is on now — the one the WAF points at — and the
# site moves to 127.0.0.1:3013 behind it (GATE_PORT, WEB_PORT and WEB_BIND
# in .env; the old .env is kept as .env.before-gate). It stays that way:
# nothing to switch back. GATE_PORT=off in .env keeps the gate out.
#
# The order is the point. New images are built while the old site keeps
# serving, so a failed build changes nothing. Only then are containers
# replaced — seconds, during which the gate (deploy/gate) shows the
# "updating" page and /status says "maintenance" rather than "down".
# Database migrations run as the API starts. Then it waits until the API
# and the site answer, and says so.

cd "$(dirname "$0")/.."

MAINTENANCE=0
NO_CACHE=()
DRY=0
for arg in "$@"; do
  case "$arg" in
    --maintenance) MAINTENANCE=1 ;;
    --no-cache) NO_CACHE=(--no-cache) ;;
    --dry-run) DRY=1 ;;
    -h | --help)
      sed -n '4,31p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (see --help)" >&2
      exit 2
      ;;
  esac
done

ENV_FILE="${ENV_FILE:-.env}"
bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
run() {
  echo "+ $*"
  if [ "$DRY" = 0 ]; then "$@"; fi
}
# A value from .env without sourcing it (values may hold anything).
env_get() {
  local value
  value="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
  echo "${value:-$2}"
}
# Sets NAME=value in .env: the line if there is one, else a new line. The
# file is rewritten in place, so its owner and permissions stay.
env_set() {
  local tmp
  tmp="$(mktemp)"
  awk -v name="$1" -v value="$2" '
    $0 ~ "^" name "=" { if (!done) print name "=" value; done = 1; next }
    { print }
    END { if (!done) print name "=" value }
  ' "$ENV_FILE" >"$tmp"
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here — run this in the Cryptovich folder on the server." >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is not installed." >&2; exit 1; }

WEB_PORT="$(env_get WEB_PORT 3000)"
API_PORT="$(env_get API_PORT 4000)"
GATE_PORT="$(env_get GATE_PORT '')"
VERSION="$(head -n 1 CHANGELOG.md | sed 's/^VERSION=//')"
# Where the site lives behind the gate.
BEHIND_GATE=3013

# The gate stands in front unless .env says GATE_PORT=off. It belongs on
# the port the WAF points at, which is where the site is until the gate
# exists — or 3003, for a site already moved to 3013 by hand.
GATE=1
MOVE_SITE=0
if [ "$GATE_PORT" = off ]; then
  GATE=0
else
  if [ -z "$GATE_PORT" ]; then
    if [ "$WEB_PORT" = "$BEHIND_GATE" ]; then GATE_PORT=3003; else GATE_PORT="$WEB_PORT"; fi
  fi
  if [ "$WEB_PORT" = "$GATE_PORT" ]; then
    MOVE_SITE=1
    [ "$GATE_PORT" = "$BEHIND_GATE" ] && BEHIND_GATE=3014
  fi
fi

# The updater (deploy/updater) installs a signed release when an
# administrator asks from the site. It is on unless SELF_UPDATE=off. It
# sees this folder at the same path as this machine does (CRYPTOVICH_DIR,
# written into .env here), so the build's relative paths mean the same.
# Run by the updater itself (UPDATER_RUN=1), this leaves the updater as it
# is: replacing the container would stop the very run doing the update.
SELF_UPDATE="$(env_get SELF_UPDATE on)"
GATE_PROFILES=()
[ "$SELF_UPDATE" = off ] || GATE_PROFILES=(--profile self-update)
GATE_COMPOSE=(docker compose --env-file "$ENV_FILE" -f deploy/gate/docker-compose.yml "${GATE_PROFILES[@]}")
GATE_BUILD=(status)
[ "$SELF_UPDATE" = off ] || [ "${UPDATER_RUN:-0}" = 1 ] || GATE_BUILD+=(updater)
if [ "$DRY" = 0 ]; then
  mkdir -p deploy/updates
  [ "$(env_get CRYPTOVICH_DIR '')" = "$(pwd)" ] || env_set CRYPTOVICH_DIR "$(pwd)"
fi

# Files the previous release had and this one does not were deleted or
# moved in the code; left here, the build would still compile them. Only
# names from the previous release's own list are removed, never one of
# this server's files, and never anything outside this folder.
if [ -f .release-files ]; then
  if [ -f .release-files.installed ]; then
    gone="$(LC_ALL=C comm -23 <(LC_ALL=C sort -u .release-files.installed) <(LC_ALL=C sort -u .release-files))"
    if [ -n "$gone" ]; then
      bold "Removing what $VERSION no longer has"
      while IFS= read -r f; do
        case "$f" in
          "" | /* | *..* | .env | .env.* | branding/* | docker-compose.override.yml | deploy/maintenance/* | .release-files*) continue ;;
        esac
        if [ -f "$f" ] || [ -L "$f" ]; then
          run rm -f -- "$f"
          [ "$DRY" = 1 ] || rmdir -p --ignore-fail-on-non-empty "$(dirname "$f")" 2>/dev/null || true
        fi
      done <<<"$gone"
    fi
  else
    echo "First release from a zip: its file list is recorded now; from the next one on, removed files are removed here too."
  fi
  [ "$DRY" = 1 ] || cp .release-files .release-files.installed
fi

bold "Cryptovich $VERSION: building the new images — the site keeps working meanwhile"
run docker compose build "${NO_CACHE[@]}" api worker web
run "${GATE_COMPOSE[@]}" build "${NO_CACHE[@]}" "${GATE_BUILD[@]}"

# Once, after a build that worked: the gate takes the WAF's port for good
# and the site moves behind it — on loopback, so nothing reaches it except
# through the gate.
if [ "$GATE" = 1 ]; then
  CHANGES=()
  [ -n "$(env_get GATE_PORT '')" ] || CHANGES+=("GATE_PORT=$GATE_PORT")
  [ "$MOVE_SITE" = 1 ] && CHANGES+=("WEB_PORT=$BEHIND_GATE")
  [ -n "$(env_get WEB_BIND '')" ] || CHANGES+=("WEB_BIND=127.0.0.1")
  if [ "${#CHANGES[@]}" -gt 0 ]; then
    if [ "$MOVE_SITE" = 1 ]; then
      bold "Putting the gate in front: it takes :$GATE_PORT, the site moves to 127.0.0.1:$BEHIND_GATE"
    else
      bold "Recording the gate's settings in $ENV_FILE"
    fi
    echo "+ $ENV_FILE: ${CHANGES[*]}"
    if [ "$DRY" = 0 ]; then
      [ -f "$ENV_FILE.before-gate" ] || cp -p "$ENV_FILE" "$ENV_FILE.before-gate"
      for change in "${CHANGES[@]}"; do env_set "${change%%=*}" "${change#*=}"; done
      echo "Saved (the previous file is $ENV_FILE.before-gate). The WAF stays pointed at :$GATE_PORT."
    fi
    [ "$MOVE_SITE" = 1 ] && WEB_PORT="$BEHIND_GATE"
  fi
fi

# The status page shows the switch as maintenance (blue, left out of
# uptime), not as an outage; with --maintenance everyone also gets the
# "updating" page. Both end when this script does, however it ends.
finish() {
  rm -f deploy/maintenance/window
  if [ "$MAINTENANCE" = 1 ]; then
    rm -f deploy/maintenance/on
    echo "\"Updating\" page off."
  fi
}
run touch deploy/maintenance/window
if [ "$MAINTENANCE" = 1 ]; then
  bold "\"Updating\" page on for everyone until this finishes"
  run touch deploy/maintenance/on
fi
if [ "$DRY" = 0 ]; then trap finish EXIT; fi

bold "Switching to the new version (migrations run as the API starts)"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# --remove-orphans also takes away the status container an older version
# ran inside this project, freeing its port for the one beside the gate.
run docker compose up -d --remove-orphans

# Before 0.6 the gate's project was called 4tip-gate. Its containers still
# hold the WAF's port and would keep the renamed one from starting, so they
# go first (seconds without the gate, once); the status page's history is
# copied into the renamed project's volume. The old volume is left as it
# was — `docker volume rm 4tip-gate_status-data` once the new one is fine.
OLD_GATE_PROJECT=4tip-gate
NEW_GATE_PROJECT=cryptovich-gate
if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$OLD_GATE_PROJECT" 2>/dev/null)" ]; then
  bold "Moving the gate from the $OLD_GATE_PROJECT project to $NEW_GATE_PROJECT"
  run docker compose --env-file "$ENV_FILE" -p "$OLD_GATE_PROJECT" -f deploy/gate/docker-compose.yml down
  if docker volume inspect "${OLD_GATE_PROJECT}_status-data" >/dev/null 2>&1 && ! docker volume inspect "${NEW_GATE_PROJECT}_status-data" >/dev/null 2>&1; then
    run docker volume create --label "com.docker.compose.project=$NEW_GATE_PROJECT" --label com.docker.compose.volume=status-data "${NEW_GATE_PROJECT}_status-data"
    run docker run --rm -v "${OLD_GATE_PROJECT}_status-data:/from:ro" -v "${NEW_GATE_PROJECT}_status-data:/to" nginx:alpine sh -c 'cp -a /from/. /to/'
  fi
fi

# After the switch: already running, the gate is left as it is; the first
# time, the old site has just let go of the port the gate takes over.
GATE_SERVICES=()
if [ "${UPDATER_RUN:-0}" = 1 ]; then
  GATE_SERVICES=(status)
  [ "$GATE" = 1 ] && GATE_SERVICES=(gate status)
fi
if [ "$GATE" = 1 ]; then
  bold "The gate (the \"updating\" page) on :$GATE_PORT, and the status page"
  run "${GATE_COMPOSE[@]}" up -d "${GATE_SERVICES[@]}"
else
  bold "The status page"
  if [ "${UPDATER_RUN:-0}" = 1 ] || [ "$SELF_UPDATE" = off ]; then
    run "${GATE_COMPOSE[@]}" up -d status
  else
    run "${GATE_COMPOSE[@]}" up -d status updater
  fi
  echo
  echo "Note: GATE_PORT=off, so for the seconds of the switch visitors see an"
  echo "error, not the \"updating\" page, and /status is reachable only through"
  echo "an nginx of your own (deploy/nginx-cryptovich.conf). To have the gate: remove"
  echo "GATE_PORT=off from $ENV_FILE and run this again."
fi
# SELF_UPDATE=off: an updater left from before is taken away.
if [ "$SELF_UPDATE" = off ] && [ "$DRY" = 0 ]; then
  docker compose --env-file "$ENV_FILE" -f deploy/gate/docker-compose.yml --profile self-update rm -sf updater >/dev/null 2>&1 || true
fi


# Answers 2xx — curl if there is one, else Node in the web container.
answers() {
  if command -v curl >/dev/null; then
    curl -fsS --max-time 5 -o /dev/null "$1"
  else
    docker compose exec -T web node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$1"
  fi
}

if [ "$DRY" = 0 ]; then
  bold "Waiting for Cryptovich to answer"
  deadline=$((SECONDS + 240))
  api_ok=0
  web_ok=0
  while [ $SECONDS -lt $deadline ]; do
    [ "$api_ok" = 1 ] || { answers "http://127.0.0.1:$API_PORT/health" && api_ok=1 && echo "API: answering"; } || true
    [ "$web_ok" = 1 ] || { answers "http://127.0.0.1:$WEB_PORT/healthz" && web_ok=1 && echo "Site: answering"; } || true
    [ "$api_ok" = 1 ] && [ "$web_ok" = 1 ] && break
    sleep 3
  done
  if [ "$api_ok" != 1 ] || [ "$web_ok" != 1 ]; then
    echo
    echo "Cryptovich did not come up within 4 minutes. The API's last words:" >&2
    docker compose logs --since "$STARTED" --tail 60 api >&2 || true
    echo >&2
    echo "Containers: docker compose ps    Logs: docker compose logs -f api web" >&2
    exit 1
  fi
  migrations="$(docker compose logs --since "$STARTED" api 2>/dev/null | grep -iE "migration|migrate" | tail -n 8 || true)"
  [ -n "$migrations" ] && { echo; echo "Database:"; echo "$migrations"; }
fi

bold "Clearing the build cache"
run docker builder prune -f

bold "Done: Cryptovich $VERSION is running"
echo "Status page: $(env_get WEB_ORIGIN '')/status"
