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
- **Ulkoiset palvelut** (tekstiviestit, sähköposti, kirjeet, etäluenta, Fennoa) moduulin `index.ts`-rajapinnan takana, ja mock-toteutus on oletus, kun avain puuttuu. Fennoaan ei koskaan tuotantoympäristöön testatessa.
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
src/app/lukema/[token]/   julkinen lukemalomake (linkki, ei kirjautumista)
src/app/api/              linkkien CSV-lataus, tekstiviestien vastaanotto
src/lib/registry/         rekisterin kyselyt
src/lib/readings/         lukeman kirjaus, tarkistukset, linkit, lukulista
src/lib/billing/          laskentamoottori (calculate), laskutusajo (run), lisätieto (info)
src/lib/sms/              tekstiviestien tulkinta ja vastaanotto, lähetys testitilassa
src/lib/import/           Fennoa-aineiston tuonnin logiikka
src/lib/fennoa/           laskukanava (channel), laskun muunnos (invoice), vienti (export), rajapinta (index: mock/test)
src/lib/announcements/    tiedotteet: vastaanottajat ja toimitustapa (index), ikkunakirjeet PDF:nä (letter)
src/lib/email/            sähköpostin lähetys (mock / Resend)
src/lib/letters/          kirjeiden postitus (mock / Postita)
scripts/karkinen/         Kärkisen aineiston jäsennys
src/lib/members.ts        käyttäjien lisäys ja roolit
supabase/migrations/      0001–0019 (ks. tiedostojen otsikot)
tests/db/                 RLS- ja kantatestit (tests/helpers/db.ts: freshDb, seedOrg)
tests/unit/               puhdas logiikka
scripts/                  kannan ylläpito, tuonnit, Joutsan hinnasto ja alueet, vertailu
```

## Komennot

```
npm run dev                  kehityspalvelin (PGlite)
npm run db:reset             tyhjä paikallinen kanta
npm run db:seed:demo         kuvitteellinen demodata
npm run tuo:asiakkaat -- <tiedosto.csv> --org "Nimi" [--luo] [--kuiva] [--tuotanto]
python scripts/fennoa/parse_invoices.py <fennoa_export.zip>
npm run tuo:laskut -- --org "Joutsan Vesihuolto Oy" [--kuiva] [--tuotanto]
npm run joutsa:hinnasto [-- --tuotanto]      Joutsan hinnasto ja perusmaksuluokat
npm run joutsa:alueet [-- --tuotanto]        alueet Unes-tunnuksesta
npm run vertaa:laskut [-- --tuotanto]        Fennoan laskut uudelleen laskettuina
python scripts/karkinen/parse.py <kansio>    Kärkisen ennakkolista, käyttöpaikat ja lainat → data/private/karkinen
npm run karkinen:tuo -- [--luo] [--korvaa] [--kuiva] [--tuotanto]
npm run karkinen:taydenna [-- --kuiva] [--tuotanto]     laskutusosoitteet, verkkolasku, sopimusten alut
npm run karkinen:vertaa [-- --tallenna] [--tuotanto]   arviolaskut ennakkolistaa vasten
python scripts/karkinen/parse_invoices.py <lasku.pdf> ...  vanhat laskut → data/private/karkinen/laskut
python scripts/karkinen/parse_readings.py <lukemat.xlsx>  mittarilukemataulukko → data/private/karkinen/lukemat.json
npm run karkinen:lukemat [-- --kuiva] [--tuotanto]      mittarit ja lukemat tasauslaskuilta ja lukemataulukosta
npm run karkinen:arviot [-- --kuiva] [--tuotanto]       vanhassa järjestelmässä laskutetut arviot tasausta varten
npm run karkinen:vertaa-tasaus [-- --tuotanto]          vuoden 2025 tasauslaskut uudelleen laskettuina
npm run karkinen:vertaa-kk -- --tiedosto <laskut.json>  arviolaskutusajo vanhoja kuukausilaskuja vasten
npm run laskutus:poista-hyvaksytty -- --ajo <tunnus> --syy "..." [--kuiva] [--tuotanto]   virheellisesti hyväksytty ajo pois
npm run kayttaja:lisaa -- --email x --org "Nimi" --rooli owner [--luo-org actual|estimate] [--tuotanto]
npm run lint && npm run typecheck && npm run test
```

`--tuotanto` kirjoittaa Supabaseen `.env.local`:n osoitteella. Käytä vain Jukan luvalla.
