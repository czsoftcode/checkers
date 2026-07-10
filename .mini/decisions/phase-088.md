# Offline AI deska musí fungovat i v insecure contextu (non-UUID id partie)

## Decision
ID lokální partie (newGameId v local-client.ts) se generuje fallback řetězcem crypto.randomUUID → crypto.getRandomValues → Date.now+Math.random, ne přímo crypto.randomUUID. AI/sólo deska tak funguje i mimo secure context — přes prosté HTTP na LAN IP i z hostingu bez TLS.

## Why
Přímé crypto.randomUUID() je dostupné jen v secure contextu (HTTPS nebo localhost). Zamítnutá alternativa „nechat randomUUID a vyžadovat secure context" by AI desku tiše rozbila přesně ve dvou scénářích, na kterých projektu záleží: ruční test na mobilu přes dev server (HTTP na LAN IP) a publikovatelný statický build servírovaný bez TLS. Fáze 87 to nechytila, protože jsdom (Node) randomUUID má; teprve reálný prohlížeč to odhalil. ID partie je jen klíč do in-memory mapy (žádná bezpečnostní ani drátová role), takže vzdát se kryptografického UUID nic nestojí a getRandomValues (dostupné i v insecure contextu) plně stačí.
