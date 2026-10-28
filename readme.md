# Habo Wolley på Lund Volley Masters 2026

Enkel översikt över matcher, domaruppdrag och slutspel för Habo Wolley FU18 White och Red.

Sidan hämtar schemat direkt från turneringens öppna API (Cupmanager) när den öppnas, var tredje minut och när du trycker på **Uppdatera**. Om turneringens server inte svarar visas den sparade kopian i `data/snapshot.json`.

## Lägga till fler lag

Öppna `app.js` och lägg till en rad i `CONFIG.teams`:

- `id` är numret i lagets länk, t.ex. `.../result/team/82397484`
- `referee` är numret i lagets domarlänk, t.ex. `.../result/referee/88506314`

Laget måste spela i samma klass (`categoryId`).
