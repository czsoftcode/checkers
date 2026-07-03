# Node 24 jako oficiální runtime projektu

## Decision
Projekt oficiálně běží na Node 24 LTS. Projektový dokument (Main constraints) byl srovnán s realitou repa (.nvmrc=24, engines >=24, CI node-version 24) a @types/node v catalogu zvednut na ^24, aby typy popisovaly skutečný runtime.

## Why
Zamítnutá alternativa: shodit repo na Node 22 LTS, aby odpovídalo původnímu projektovému dokumentu. Repo ale na Node 24 běželo od první fáze, Node 24 je dnes aktivní LTS a downgrade by byl práce navíc bez přínosu - žádný kód na Node 22 nezávisí. Nebezpečný nebyl samotný Node 24, ale tichý rozjezd tří míst: dokument sliboval 22, runtime byl 24 a typy popisovaly 22. Sjednocení na 24 je nejlevnější cesta, jak rozjezd ukončit (nález 10-1).
