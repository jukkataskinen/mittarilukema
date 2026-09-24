# Mittarilukema – rakennusohje Claude Codelle

Vesihuoltolaitosten mittarilukema- ja laskutusohjelma, joka korvaa mittarilukema.fi:n. Asiakkaat: Joutsan Vesihuolto Oy (noin 1000 asiakasta, toteutunut kulutus maalis- ja syyskuussa) ja Kärkisten vesiosuuskunta (noin 150 osakasta, arviolasku kuukausittain ja vuositasaus). Rakenne ja tyyli ovat samat kuin eRapussa (`../erappu`).

**Älä kysy käyttäjältä mitään, mikä on tässä tai DECISIONS.md:ssä päätetty.** Jos joudut tekemään uuden päätöksen, tee se tämän dokumentin hengessä ja kirjaa se `DECISIONS.md`:ään. Jos et voi edetä puuttuvan tiedon takia, kirjaa asia `BLOCKERS.md`:hen ja jatka seuraavaan tehtävään.

## Työskentelyprotokolla

1. Lue `CLAUDE.md`, `PLAN.md`, `DECISIONS.md` ja `BLOCKERS.md`.
2. Tee `PLAN.md`:n seuraava tekemätön tehtävä kokonaan: koodi, testit, migraatio ja dokumentaatio.
3. Aja `npm run lint && npm run typecheck && npm run test`. Korjaa virheet ennen jatkamista.
4. Merkitse tehtävä tehdyksi `PLAN.md`:ssä ja kirjaa päätökset `DECISIONS.md`:ään (päivä, päätös, perustelu 1–3 riviä).
5. Commitoi. Pushaa vain Jukan luvalla: push `main`-haaraan julkaisee Verceliin ja ajaa migraatiot tuotantokantaan.

## Säännöt

- **Käyttöliittymä suomeksi, koodi ja tietokanta englanniksi.** Kommentit suomeksi ja ne kertovat *miksi*. Sävy: sinuttelu, rauhallinen, ei huutomerkkejä, ei emojeita.
- **Jokainen uusi taulu:** etuliite `ml_`, `organization_id`, RLS päälle, policyt ja eksplisiittiset GRANTit (`authenticated`, `service_role`). Viittaus toiseen tauluun saman organisaation sisällä varmistetaan triggerillä `ml_check_same_org`. Lisää taulu `tests/db/rls.test.ts`:n listaan.
- **Kaikki kantakutsut `src/lib/db`-kerroksen kautta:** `ctx.run(tx => ...)` käyttäjän RLS-transaktiossa. `db.asService` vain skripteihin, kirjautumiseen ja tuleviin taustatöihin (tekstiviestit, etäluenta).
- **Henkilötiedot:** asiakastiedostot, varmuuskopiot ja viennit eivät koskaan gittiin (`.gitignore`, CI-vahti). Skriptit tulostavat vain määriä. Ei henkilötietoja URL-osoitteisiin, lokeihin tai virheviesteihin. Henkilötunnuksia ei käsitellä.
- **Muutokset lokiin:** `audit()` samassa transaktiossa kuin muutos.
- **Lomakkeet:** server action → `parseForm(schema, formData, backTo)`. Virhe `?virhe=`-parametrilla, sivu näyttää sen `<FormError>`-komponentilla.
- **Päivämäärät ja rahat:** kanta `date` ja `numeric`, näyttö `src/lib/format.ts` (Europe/Helsinki). Lukemat `numeric(12,3)`.
- **Ulkoiset palvelut** (tekstiviestit, etäluenta, Fennoa) moduulin `index.ts`-rajapinnan takana, ja mock-toteutus on oletus, kun avain puuttuu. Fennoaan ei koskaan tuotantoympäristöön testatessa.
- **Tuotantoon ei kosketa:** mittarilukema.fi pysyy käytössä rinnakkaisajon loppuun asti.

## Lukitut päätökset

| Aihe | Päätös |
|---|---|
| Runko | Next.js 15 App Router, React 19, TypeScript strict, Tailwind 4. Palvelinkomponentit ja server actionit. |
| Ulkoasu | eRapun ja Reilusopparin perusilme (`src/app/globals.css`, `src/components/ui.tsx`): `ink`, `cloud`, `line`, `sky` = toiminto, `coral` = vaatii huomiota, `moss` = valmis, `amber` = odottaa. Plus Jakarta Sans. Henkilökunnan näkymät työpöytä ensin (`StaffShell`). |
| Tietokanta | Paikallisesti PGlite (`.data/pglite`), tuotannossa oma Supabase-projekti (eu-west-1). Migraatiot `supabase/migrations/NNNN_nimi.sql`: paikallisesti automaattisesti, Supabaseen Vercelin tuotantobuildissa (`scripts/db/migrate-remote.mts`). |
| Kirjautuminen | `AUTH_MODE=dev` kehityksessä (käyttäjän valinta, estetty tuotannossa), `AUTH_MODE=auth0` tuotannossa (BLOCKERS 6). |
| Roolit | `owner` pääkäyttäjä, `staff` toimisto, `reader` mittarinlukija. |
| Laskutustapa | Organisaation asetus (`billing_method`, `billing_months`, `settlement_month`), kiinteistökohtainen poikkeus `ml_properties.billing_method`. |

## Rakenne

```
src/app/(henkilokunta)/   henkilökunnan sivut (StaffShell, requireStaff)
src/app/kirjaudu/         kirjautuminen
src/lib/db/               kantakerros (PGlite / Postgres)
src/lib/auth/             istunto, käyttäjä ja roolit
src/lib/registry/         rekisterin kyselyt
src/lib/readings/         lukeman kirjaus ja tarkistukset
supabase/migrations/      0001 perusta, 0002 rekisteri, 0003 lukemat, 0004 hinnasto
tests/db/                 RLS- ja kantatestit (tests/helpers/db.ts: freshDb, seedOrg)
tests/unit/               puhdas logiikka
scripts/                  db-reset, seed-demo, import-customers, migrate-remote
```

## Komennot

```
npm run dev                  kehityspalvelin (PGlite)
npm run db:reset             tyhjä paikallinen kanta
npm run db:seed:demo         kuvitteellinen demodata
npm run tuo:asiakkaat -- <tiedosto.csv> --org "Nimi" [--luo] [--kuiva]
npm run lint && npm run typecheck && npm run test
```
