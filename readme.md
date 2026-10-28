# Habo Wolley på Lund Volley Masters 2026

Enkel översikt över matcher, domaruppdrag och slutspel för alla Habo Wolleys lag.

Turneringens server tillåter inte anrop direkt från andra webbplatser, så en GitHub Action (`.github/workflows/update.yml`) kontrollerar schemat var tredje minut och sparar det i `data/schedule.json` när något ändrats (och minst var 30:e minut som livstecken). Varje körning håller igång i knappt sex timmar och startar sedan själv nästa (GitHubs schemaläggning finns kvar som reserv men har visat sig opålitlig). Sidan varnar om schemat inte kontrollerats på 45 minuter. Sidan läser den filen. Vill du tvinga fram en uppdatering: gå till fliken **Actions**, välj **Uppdatera schemat** och tryck **Run workflow**.

## Lag och klasser

Klubbens lag, klasser och domar-id hittas automatiskt via klubb-id:t i `scripts/schedule.mjs` (`CONFIG.clubId`), så nya lag i turneringen kommer med av sig själva. Vill du följa en annan klubb räcker det att byta klubb-id (numret i klubbens länk, t.ex. `.../result/club/82383983`).
