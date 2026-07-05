#!/usr/bin/env bash
#
# Produkční deploy pro dama.softcode.cz.
#
# Architektura (viz docs/dama_klient_server_architektura.svg):
#   - Web (Vite SPA) se builduje staticky do packages/web/dist a nginx ho
#     servíruje z rootu domény. Proto build MUSÍ mít base "/" (jinak 404 na
#     hashovaných assetech).
#   - Backend (@checkers/server, fastify + engine podproces) běží trvale jako
#     systemd služba `dama-server` a naslouchá na 127.0.0.1:3000. nginx k němu
#     reverzně proxuje cesty /games… . V produkci tak vite `server.proxy`
#     (jen pro dev) nahrazuje právě nginx.
#
# Skript je idempotentní: jde pustit opakovaně pro restart/redeploy.
#
# POZOR na node: package.json chce node >=24, na stroji běží 22 → pnpm to jen
# WARNuje a vše funguje. Až se node povýší, warning zmizí; nic tu neměň.

set -euo pipefail

# Kořen repa bez ohledu na to, odkud se skript spustí.
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

SERVICE="dama-server"
WEB_DIR="packages/web"
TMP_DIR="$WEB_DIR/dist.tmp"
OUT_DIR="$WEB_DIR/dist"

# pnpm bereme přes corepack (na stroji není globální pnpm shim).
PNPM=(corepack pnpm)

echo "==> Instalace závislostí (pnpm install --frozen-lockfile)"
"${PNPM[@]}" install --frozen-lockfile

echo "==> Typecheck (server, engine, web, rules)"
"${PNPM[@]}" -r typecheck

echo "==> Build webu s base=/ do $TMP_DIR"
# Build jde nejdřív do dočasné složky a teprve pak atomicky nahradí dist,
# aby nginx během buildu neservíroval prázdný/polovičatý adresář.
rm -rf "$TMP_DIR"
"${PNPM[@]}" --filter @checkers/web exec vite build --base=/ --outDir dist.tmp --emptyOutDir

echo "==> Atomická výměna $OUT_DIR"
rm -rf "$OUT_DIR"
mv "$TMP_DIR" "$OUT_DIR"

echo "==> Restart backendu (systemd: $SERVICE)"
# Restart potřebuje root; když skript neběží jako root, použijeme sudo.
if [[ "$(id -u)" -eq 0 ]]; then
  systemctl restart "$SERVICE"
else
  sudo systemctl restart "$SERVICE"
fi

# Ověření, že služba po restartu skutečně běží (jinak deploy skončí chybou).
echo "==> Kontrola stavu služby"
sleep 1
if [[ "$(id -u)" -eq 0 ]]; then
  systemctl is-active --quiet "$SERVICE"
else
  sudo systemctl is-active --quiet "$SERVICE"
fi
echo "    Služba $SERVICE běží."

echo "==> Hotovo. Web: $REPO_ROOT/$OUT_DIR  ·  backend: 127.0.0.1:3000 (systemd)"
