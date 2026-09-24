# Mittarilukema – PLAN

Merkinnät: `[x]` valmis, `[ ]` tekemättä, `[~]` kesken tai odottaa estettä (BLOCKERS.md).

## Asiakkaat

| Asiakas | Koko | Laskutus |
|---|---|---|
| Joutsan Vesihuolto Oy | noin 1000 asiakasta | Toteutunut kulutus, maalis- ja syyskuussa |
| Kärkisten vesiosuuskunta (tulossa) | noin 150 osakasta | Arviolasku kuukausittain, tasaus vuosittain |

## Toimialan perusasiat

- Kiinteistöllä voi olla puhtaan veden liittymä, jäteveden liittymä tai molemmat.
- Laskutettava on yleensä kiinteistön omistaja. Käyttösopimuksella laskutetaan vuokralaista.
- Mittarit ovat osin etäluettavia ja osin mekaanisia. Mekaanisten lukemat ilmoitetaan tekstiviestillä.
- Maksulajit:
  - perusmaksu alueittain
  - käyttömaksu kulutuksen mukaan (€/m³)
  - Kärkisissä lisäksi lainaosuus ja lisäperusmaksu

## Tietomallin runko (luonnos)

- **Organisaatio**: vesihuoltolaitos. Kukin näkee vain omat tietonsa.
- **Alue** → **kiinteistö** → **liittymä** (vesi / jätevesi) → **mittari** (etä / mekaaninen, asennus- ja poistopäivä) → **lukemat** (lähde: etäluenta, tekstiviesti, lukija, arvio)
- **Asiakas** ja **sopimus**: kuka maksaa mistäkin kiinteistöstä ja mistä mihin päivään, omistajana tai vuokralaisena.
- **Hinnasto**: maksulaji, hinta, voimassaolo, organisaatio ja tarvittaessa alue.
- **Laskutustapa ja -jakso**: organisaation asetus, joka voi poiketa kiinteistökohtaisesti.
- **Lasku** ja **laskurivit** → Fennoa.

## Vaiheet

### Perusta
- [x] GitHub-repo `jukkataskinen/Mittarilukema` (yksityinen)
- [x] Suunnitelmatiedostot repoon
- [ ] Oma Supabase-projekti (ei jaettua `skog`-projektia)
- [ ] Sovelluksen runko (Next.js, sama pino kuin eRapussa)
- [ ] Vercel-projekti

### Tiedot
- [~] mittarilukema.fi:n varmuuskopio ja tietokannan rakenne (BLOCKERS 1)
- [ ] Tietomalli ja migraatiot
- [ ] Tiedonsiirto mittarilukema.fi:stä kopioon

### Lukemat
- [ ] Etäluettavien mittarien lukemien tuonti (BLOCKERS 4)
- [~] Tekstiviestilukemat, sama numero ja palvelu kuin nyt (BLOCKERS 2)
- [ ] Muistutusviestit ja poikkeavien lukemien tarkistus

### Laskutus
- [ ] Toteutuneen kulutuksen laskutus (Joutsa)
- [ ] Arviolasku ja vuositasaus (Kärkinen)
- [ ] Laskujen vienti Fennoaan (testiympäristöön, ei tuotantoon)

### Käyttöönotto
- [ ] Rinnakkaisajo mittarilukema.fi:n kanssa, tulosten vertailu
- [ ] Siirtyminen, domainin mittarilukema.fi uudelleenohjaus
