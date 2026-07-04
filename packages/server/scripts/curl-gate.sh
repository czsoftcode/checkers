#!/usr/bin/env bash
#
# Brána fáze 18: odehraje kompletní partii přes REÁLNĚ běžící server pomocí
# curl. Ověří, že server (jediná autorita) nikdy neodmítne legální tah a partie
# dospěje k terminálnímu výsledku; navíc demonstruje 404 a 409.
#
# Engine v této fázi NENÍ – oba tahy hraje sám skript tak, že posílá vždy první
# legální tah z aktuálního stavu (netestuje kvalitu hry, jen autoritu a API).
#
# Použití:  packages/server/scripts/curl-gate.sh
# Vyžaduje: curl, jq. Server se startuje a zabíjí automaticky.

set -euo pipefail

PORT="${PORT:-3999}"
BASE="http://127.0.0.1:${PORT}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG="$(mktemp)"
BODY="$(mktemp)"

fail() {
  echo "BRÁNA SELHALA: $*" >&2
  echo "--- log serveru ---" >&2
  cat "$LOG" >&2 || true
  exit 1
}

cleanup() {
  # Zabij server podle PORTU. Pre-check níže zaručuje, že port byl PŘED startem
  # volný, takže cokoli na něm teď poslouchá je náš proces. Spolehlivější než
  # hádat PGID – wrapper (pnpm → tsx → node) tříští PID i skupinu procesů.
  local port_pid
  port_pid="$(ss -ltnpH "sport = :${PORT}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)" || true
  [[ -n "$port_pid" ]] && kill "$port_pid" 2>/dev/null || true
  # A launcher/wrapper, kdyby po smrti listener-procesu sám nezmizel.
  [[ -n "${SERVER_PID:-}" ]] && kill "${SERVER_PID}" 2>/dev/null || true
  # Počkej, až se port opravdu uvolní (node ho po SIGTERM pouští se zpožděním),
  # ať brána nezanechá závodící socket. Po timeoutu tvrdě SIGKILL.
  for _ in $(seq 1 20); do
    ss -ltnH "sport = :${PORT}" 2>/dev/null | grep -q . || break
    sleep 0.1
  done
  if [[ -n "$port_pid" ]] && ss -ltnH "sport = :${PORT}" 2>/dev/null | grep -q .; then
    kill -9 "$port_pid" 2>/dev/null || true
  fi
  rm -f "$LOG" "$BODY"
}
trap cleanup EXIT

# curl_status URL/argy… → vytiskne HTTP kód, tělo uloží do $BODY.
curl_status() {
  curl -s -o "$BODY" -w '%{http_code}' "$@"
}

# Pre-check: port musí být PŘED startem volný. Kdyby na něm už někdo
# poslouchal (osiřelý server z rozbitého běhu, cizí proces), náš nový server by
# spadl na EADDRINUSE, ale readiness-probe by odpověděl ten CIZÍ → brána by
# projela „nazeleno" proti špatnému serveru. Radši selhat hlučně.
if curl -s -o /dev/null "${BASE}/games/probe"; then
  fail "port ${PORT} už někdo poslouchá – ukonči ho, nebo spusť s jiným PORT=…"
fi

echo "› Startuji server na portu ${PORT}…"
( cd "$REPO_ROOT" && exec env PORT="$PORT" pnpm --filter @checkers/server exec tsx src/main.ts ) >"$LOG" 2>&1 &
SERVER_PID=$!

# Čekej, až server přijímá spojení (jakákoli HTTP odpověď = běží). Když proces
# mezitím spadne, nemá smysl čekat dál.
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "server spadl při startu"
  fi
  if curl -s -o /dev/null "${BASE}/games/probe"; then
    break
  fi
  sleep 0.2
done
curl -s -o /dev/null "${BASE}/games/probe" || fail "server nenaběhl do 10 s"

echo "› Zakládám partii…"
code="$(curl_status -X POST "${BASE}/games")"
[[ "$code" == "201" ]] || fail "POST /games vrátil $code (čekáno 201)"
GAME_ID="$(jq -r '.id' "$BODY")"
[[ -n "$GAME_ID" && "$GAME_ID" != "null" ]] || fail "POST /games nevrátil id"
echo "  id = ${GAME_ID}"

echo "› Hraji partii vždy prvním legálním tahem…"
result="$(jq -r '.result' "$BODY")"
plies=0
while [[ "$result" == "ongoing" ]]; do
  plies=$((plies + 1))
  if [[ "$plies" -gt 1000 ]]; then
    fail "partie nedospěla ke konci ani po 1000 tazích"
  fi
  # Ongoing partie MUSÍ mít legální tah (jinak by výsledek nebyl 'ongoing').
  [[ "$(jq '.legalMoves | length' "$BODY")" -gt 0 ]] || fail "ongoing partie bez legálního tahu (tah $plies)"
  # Sestav tělo tahu z prvního legálního tahu aktuálního stavu.
  payload="$(jq -c '{from: .legalMoves[0].from, path: .legalMoves[0].path}' "$BODY")"
  code="$(curl_status -X POST "${BASE}/games/${GAME_ID}/moves" \
    -H 'content-type: application/json' -d "$payload")"
  # Klíčová podmínka brány: server NIKDY neodmítne legální tah.
  [[ "$code" == "200" ]] || fail "legální tah $payload odmítnut kódem $code (tah $plies): $(cat "$BODY")"
  result="$(jq -r '.result' "$BODY")"
done
echo "  partie skončila po ${plies} tazích, výsledek: ${result}"
[[ "$result" != "ongoing" ]] || fail "partie neskončila terminálním výsledkem"

echo "› Tah do skončené partie → 409 game_over…"
code="$(curl_status -X POST "${BASE}/games/${GAME_ID}/moves" \
  -H 'content-type: application/json' -d '{"from":1,"path":[5]}')"
[[ "$code" == "409" ]] || fail "tah do konce vrátil $code (čekáno 409)"
[[ "$(jq -r '.error.code' "$BODY")" == "game_over" ]] || fail "čekán kód game_over, přišlo: $(cat "$BODY")"

echo "› Neexistující partie → 404 game_not_found…"
code="$(curl_status "${BASE}/games/neexistuje")"
[[ "$code" == "404" ]] || fail "GET neexistující vrátil $code (čekáno 404)"
[[ "$(jq -r '.error.code' "$BODY")" == "game_not_found" ]] || fail "čekán kód game_not_found, přišlo: $(cat "$BODY")"

echo "› Nelegální tah (setrvání na místě) → 409 illegal_move + legalMoves…"
code="$(curl_status -X POST "${BASE}/games" )"  # čerstvá partie pro demo
demo_id="$(jq -r '.id' "$BODY")"
code="$(curl_status -X POST "${BASE}/games/${demo_id}/moves" \
  -H 'content-type: application/json' -d '{"from":9,"path":[9]}')"
[[ "$code" == "409" ]] || fail "nelegální tah vrátil $code (čekáno 409)"
[[ "$(jq -r '.error.code' "$BODY")" == "illegal_move" ]] || fail "čekán kód illegal_move, přišlo: $(cat "$BODY")"
[[ "$(jq -r '.legalMoves | length' "$BODY")" -gt 0 ]] || fail "409 illegal_move nepřiložil legalMoves"

echo
echo "BRÁNA OK: kompletní partie odehrána přes curl, server nepřijal nelegální tah, 404/409 sedí."
