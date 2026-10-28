# Habo Wolley på Lund Volley Masters 2026

Enkel översikt över matcher, domaruppdrag och slutspel för Habo Wolley FU18 White och Red.

Turneringens server tillåter inte anrop direkt från andra webbplatser, så en GitHub Action (`.github/workflows/update.yml`) hämtar schemat ungefär var 10:e minut och sparar det i `data/schedule.json` när något ändrats. Sidan läser den filen. Vill du tvinga fram en uppdatering: gå till fliken **Actions**, välj **Uppdatera schemat** och tryck **Run workflow**.

## Lägga till fler lag

Öppna `scripts/schedule.mjs` och lägg till en rad i `CONFIG.teams`:

- `id` är numret i lagets länk, t.ex. `.../result/team/82397484`
- `referee` är numret i lagets domarlänk, t.ex. `.../result/referee/88506314`

Laget måste spela i samma klass (`categoryId`).
