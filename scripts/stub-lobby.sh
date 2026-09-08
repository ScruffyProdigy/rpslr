#!/usr/bin/env bash
# Replay a pre-queue provision fixture against a locally-running game API.
#
# Stands in for JoinQuest so the game repo can exercise duel-helpers without a
# lobby: CI has no lobby, and the real one is often mid-change. It is a test
# double, not the primary path — the real pick happens pre-queue in the lobby.
#
#   ./scripts/stub-lobby.sh                     list the fixtures
#   ./scripts/stub-lobby.sh valid               provision, print the play URLs
#   ./scripts/stub-lobby.sh duplicate-helper    expect a 400
#   ./scripts/stub-lobby.sh --all               run every fixture, check each expectation
#
# Fixtures live in docs/fixtures/prequeue and are the contract's specification:
# see docs/prequeue-options-contract.md.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

FIXTURE_DIR="$REPO_ROOT/docs/fixtures/prequeue"
API="http://localhost:${API_PORT}"

list_fixtures() {
  find "$FIXTURE_DIR" -name 'provision.*.json' -exec basename {} .json \; \
    | sed 's/^provision\.//' | sort
}

require_api() {
  if ! curl -fsS "$API/healthz" >/dev/null 2>&1; then
    die "No game API on ${API}. Start it with ./scripts/dev.sh first."
  fi
}

# Reads a JSON path out of a fixture. jq is not assumed — python3 ships with macOS.
fixture_field() {
  python3 -c "
import json,sys
d = json.load(open(sys.argv[1]))
cur = d
for key in sys.argv[2].split('.'):
    cur = cur.get(key) if isinstance(cur, dict) else None
    if cur is None:
        print(''); sys.exit(0)
print(json.dumps(cur) if isinstance(cur, (dict, list)) else cur)
" "$1" "$2"
}

# Provision is idempotent on externalMatchId: re-pushing an id that already exists
# returns the existing match *before* any pre-queue validation runs. That is correct
# for the lobby's retry contract, but it means a row left in a dev database answers
# instead of the expectation you just changed — a fixture that flipped from 201 to
# 400 will keep reporting 201. So every run gets its own id.
fresh_request() {
  python3 -c "
import json, sys, time
d = json.load(open(sys.argv[1]))['request']
d['assignment']['externalMatchId'] += '-' + str(int(time.time() * 1000))
print(json.dumps(d))
" "$1"
}

run_fixture() {
  local name="$1" file="$FIXTURE_DIR/provision.$1.json"
  [ -f "$file" ] || die "No such fixture: $name (try: $(list_fixtures | tr '\n' ' '))"

  local want_status body status response
  want_status="$(fixture_field "$file" expect.status)"
  body="$(fresh_request "$file")"

  log "POST /api/v1/matches  ($name, expecting $want_status)"
  response="$(curl -sS -o /tmp/stub-lobby-body.$$ -w '%{http_code}' \
    -X POST "$API/api/v1/matches" \
    -H 'Content-Type: application/json' \
    -d "$body")"
  status="$response"

  if [ "$status" != "$want_status" ]; then
    err "Expected HTTP $want_status, got $status"
    cat /tmp/stub-lobby-body.$$ >&2; echo >&2
    rm -f /tmp/stub-lobby-body.$$
    return 1
  fi

  local want_reason
  want_reason="$(fixture_field "$file" expect.reason)"
  if [ -n "$want_reason" ] && ! grep -qF "$want_reason" /tmp/stub-lobby-body.$$; then
    err "Response did not mention: $want_reason"
    cat /tmp/stub-lobby-body.$$ >&2; echo >&2
    rm -f /tmp/stub-lobby-body.$$
    return 1
  fi

  ok "$name → $status"

  # On a successful provision, surface the play URLs so the match is actually playable.
  if [ "$status" = "201" ]; then
    python3 -c "
import json
d = json.load(open('/tmp/stub-lobby-body.$$'))
urls = d.get('launchUrls') or {}
if urls:
    for user, url in urls.items():
        print(f'  {user}: {url}')
else:
    ref = d.get('externalMatchId') or d.get('match', {}).get('externalMatchId', '?')
    print(f'  no launchUrls in response; match ref = {ref}')
"
  fi
  rm -f /tmp/stub-lobby-body.$$
}

main() {
  case "${1:-}" in
    ''|-h|--help)
      info "Fixtures:"; list_fixtures | sed 's/^/  /'
      info "Usage: ./scripts/stub-lobby.sh <fixture> | --all"
      ;;
    --all)
      require_api
      local failed=0
      while read -r name; do
        run_fixture "$name" || failed=$((failed + 1))
      done < <(list_fixtures)
      [ "$failed" -eq 0 ] || die "$failed fixture(s) did not match the contract."
      ok "Every provision fixture matches the contract."
      ;;
    *)
      require_api
      run_fixture "$1"
      ;;
  esac
}

main "$@"
