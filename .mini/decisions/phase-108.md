# Modal přezdívky je zavíratelný, ne brána identity

## Decision
Modal pro zadání přezdívky je VŽDY zavíratelný (Zrušit/Esc/klik mimo) a nad akordeonem je trvalé tlačítko „Přihlásit se ke hře s lidmi" (bez nicku) / „Jsi přihlášen jako X" (s nickem) jako cesta zpět k PvP. „Vstoupit" v nepřipojeném stavu neposílá enter naslepo, ale otevře modal přihlášení.

## Why
Diskuze fáze 108 chtěla modal při prvním načtení NEzavíratelný (brána identity – „bez nicku ze stránky neodejdeš, jinak se počty nenačtou"). Jenže modal je celoobrazovkový overlay (position:fixed, inset:0), takže by překryl i „Hrát proti počítači". Nový hráč, který chce hrát jen proti AI (jedno ze dvou hlavních publik, základ itch buildu), by byl nucen vymyslet a odeslat PvP přezdívku – to přímo porušuje projektové „solo se nesmí rozbít". Nezávislý sub-agent review to označil jako HIGH regresi. Zavíratelný modal + trvalý re-vstup „Přihlásit se" zpřístupní solo bez připojení a PvP nechá jedno kliknutí daleko. Cena: solo-only hráč bez uložené přezdívky vidí (zavíratelný) modal při každém načtení – vědomý kompromis ve prospěch nápadnosti PvP vstupu.
