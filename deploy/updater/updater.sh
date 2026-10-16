#!/usr/bin/env bash
# The updater. It listens on nothing: every few seconds it says it is here
# (updater.json), and looks for a request the API left in the shared folder
# (request.json). A request is carried out only if it is for a release of
# palmdm/Cryptovich on GitHub, newer than the installed version, and signed
# with the key the installed version carries (deploy/release-key.pub) —
# so whatever wrote the request, nothing else can be installed. Then the
# zip is unpacked over the installation and scripts/upgrade.sh runs, as it
# would by hand. What happens is written to status.json for the site.
set -uo pipefail

DIR=/srv/updates
PROJECT="${CRYPTOVICH_DIR:-}"
DOWNLOADS="https://github.com/palmdm/Cryptovich/releases/download/"
WORK="$DIR/work"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
write_json() { # file json
  printf '%s\n' "$2" >"$1.tmp" && mv "$1.tmp" "$1"
}
status() { # state version message [logfile]
  local log=""
  [ -n "${4:-}" ] && [ -f "$4" ] && log="$(tail -n 60 "$4")"
  write_json "$DIR/status.json" "$(jq -n --arg state "$1" --arg version "$2" --arg message "$3" --arg log "$log" --arg at "$(now)" '{state:$state,version:$version,message:$message,log:$log,at:$at}')"
}
current_version() { head -n 1 "$PROJECT/CHANGELOG.md" 2>/dev/null | sed 's/^VERSION=//'; }
newer() { # a b → true when a > b
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]
}

carry_out() {
  mkdir -p "$WORK"
  mv "$DIR/request.json" "$WORK/request.json" || return
  local version zip_url sig_url
  version="$(jq -r '.version // ""' "$WORK/request.json")"
  zip_url="$(jq -r '.zipUrl // ""' "$WORK/request.json")"
  sig_url="$(jq -r '.signatureUrl // ""' "$WORK/request.json")"

  if ! [[ "$version" =~ ^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,6}$ ]]; then status failed "$version" "Not a version."; return; fi
  if [[ "$zip_url" != "$DOWNLOADS"*"/cryptovich-$version.zip" || "$sig_url" != "$DOWNLOADS"*"/cryptovich-$version.zip.sig" ]]; then
    status failed "$version" "Only a release of palmdm/Cryptovich on GitHub is installed."; return
  fi
  if ! newer "$version" "$(current_version)"; then status failed "$version" "Not newer than the installed version."; return; fi
  if [ ! -f "$PROJECT/deploy/release-key.pub" ]; then status failed "$version" "No release key here: update from the server."; return; fi

  status downloading "$version" "Downloading."
  rm -f "$WORK/release.zip" "$WORK/release.zip.sig"
  if ! curl -fsSL --max-filesize 314572800 -o "$WORK/release.zip" "$zip_url" || ! curl -fsSL --max-filesize 4096 -o "$WORK/release.zip.sig" "$sig_url"; then
    status failed "$version" "Could not download the release."; return
  fi
  if ! openssl pkeyutl -verify -pubin -inkey "$PROJECT/deploy/release-key.pub" -rawin -in "$WORK/release.zip" -sigfile "$WORK/release.zip.sig" >/dev/null 2>&1; then
    status failed "$version" "The signature does not match: nothing was installed."; return
  fi

  status installing "$version" "Unpacking."
  if ! unzip -o -q "$WORK/release.zip" -d "$PROJECT"; then status failed "$version" "Could not unpack the release."; return; fi

  status installing "$version" "Building and switching (scripts/upgrade.sh)."
  if (cd "$PROJECT" && UPDATER_RUN=1 ./scripts/upgrade.sh) >"$WORK/upgrade.log" 2>&1; then
    status done "$version" "Installed." "$WORK/upgrade.log"
  else
    status failed "$version" "scripts/upgrade.sh failed." "$WORK/upgrade.log"
  fi
}

mkdir -p "$DIR"
while true; do
  if [ -n "$PROJECT" ] && [ -f "$PROJECT/CHANGELOG.md" ]; then
    has_key=false
    [ -f "$PROJECT/deploy/release-key.pub" ] && has_key=true
    write_json "$DIR/updater.json" "$(jq -n --arg at "$(now)" --argjson hasKey "$has_key" --arg version "$(current_version)" '{at:$at,hasKey:$hasKey,version:$version}')"
    [ -f "$DIR/request.json" ] && carry_out
  fi
  sleep 5
done
