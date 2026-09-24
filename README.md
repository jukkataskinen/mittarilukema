# Mittarilukema

Vesihuoltolaitosten laskutusohjelma. Ohjelma kerää mittarilukemat etäluettavista mittareista ja asiakkaiden ilmoituksista, laskee maksut ja lähettää laskut Fennoaan.

Tämä korvaa nykyisen mittarilukema.fi-ohjelmiston, jota kehitetään käsin koodaten hitaasti ja kalliisti.

- Suunnitelma ja eteneminen: [PLAN.md](PLAN.md)
- Tehdyt päätökset perusteluineen: [DECISIONS.md](DECISIONS.md)
- Asiat, jotka odottavat tietoa tai päätöstä: [BLOCKERS.md](BLOCKERS.md)
- Ohjeet kehitykseen: [CLAUDE.md](CLAUDE.md)

## Kehitys

```
npm install
npm run db:seed:demo
npm run dev
```

Avaa http://localhost:3000 ja valitse käyttäjä. Kehityksessä kanta on paikallinen (`.data/pglite`), eikä Supabaseen kirjoiteta mitään.

Omistaja: Jukka Taskinen / Adepta.
