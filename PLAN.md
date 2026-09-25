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

## Aikataulu (arvio 24.9.2026)

Oletus: osa-aikainen työ kuten eRapussa, varmuuskopio ja tekstiviestitiedot saadaan 1–2 viikossa. Aikataulun määräävät Joutsan laskutuskierrokset: syyskuu 2026 laskutetaan vielä vanhalla ohjelmalla, seuraava kierros on maaliskuu 2027. Ennen sitä syyskuun 2026 laskut lasketaan uudelleen varmuuskopion tiedoista ja verrataan vanhan ohjelman laskuihin.

| Vaihe | Työmäärä | Tavoite |
|---|---|---|
| Perusta | 3–5 pv | vko 41 |
| Tietomalli ja tiedonsiirto | 1–2 vk | vko 43–44 |
| Ylläpitonäkymät | 2–3 vk | vko 46–47 |
| Lukemat (tekstiviesti, lomake, muistutukset) | 1,5–2 vk | vko 48 |
| Joutsan laskutus ja Fennoa-vienti testiin | 2–3 vk | vko 50 |
| Vertailu syyskuun 2026 laskuihin | 1–2 vk | tammikuun puoliväli 2027 |
| Etäluettavien tuonti | ~1 vk | helmikuu 2027 |
| Rinnakkaisajo ja siirtyminen (Joutsa) | – | maalis–huhtikuu 2027 |
| Kärkisen laskutus | 1,5–2 vk | Kärkisen aloituksen mukaan, aikaisintaan tammikuu 2027 |

Riskit: varmuuskopio on kriittisellä polulla; tekstiviestinumeron siirto voi viedä 1–2 vk lisää; vanhan kannan tietojen siivous voi viedä 1–2 vk lisää; Fennoan testiympäristön pääsy varmistettava ennen joulukuuta.

## Vaiheet

### Perusta (vko 41)
- [x] GitHub-repo `jukkataskinen/mittarilukema` (yksityinen)
- [x] Suunnitelmatiedostot repoon
- [x] Oma Supabase-projekti (ei jaettua `skog`-projektia)
- [x] Sovelluksen runko (Next.js, sama pino kuin eRapussa)
- [x] Tietokantayhteys Supabaseen (jaettu pooleri, Irlanti)
- [x] Kirjautuminen: Auth0 (eRapun tenantti, MFA)
- [x] Tietokannan osoite Verceliin ja ensimmäinen tuotantojulkaisu
- [x] Organisaatiot ja pääkäyttäjä tuotantokantaan
- [x] Käyttäjien lisäys, roolit ja poisto Asetuksissa
- [x] Vercel-projekti

### Tiedot (vko 43–47)
- [~] mittarilukema.fi:n varmuuskopio ja tietokannan rakenne (BLOCKERS 1)
- [~] Tietomalli ja migraatiot: 0001–0014 tehty, tarkistetaan varmuuskopiota vasten
- [ ] Tiedonsiirto mittarilukema.fi:stä kopioon
- [x] Ylläpitonäkymät: kiinteistöt, mittarit, asiakkaat, sopimukset, hinnasto
- [x] Asiakasluettelon tuonti CSV:stä (857 riviä Joutsasta)
- [x] Fennoan myyntilaskut 2026 rekisterin pohjaksi: kiinteistöt, liittymät, mittarit, lukemat, sopimukset (tuotannossa 25.9.2026)

### Lukemat (vko 48, etäluettavat helmikuu 2027)
- [ ] Etäluettavien mittarien lukemien tuonti (BLOCKERS 4)
- [~] Tekstiviestilukemat: vastaanotto, tulkinta, yhdistäminen asiakkaaseen ja käsittelynäkymä valmiit; palveluntarjoaja ja numeron siirto auki (BLOCKERS 2)
- [x] Poikkeavien lukemien tarkistus ja hyväksyntä
- [x] Lukukierrokset
- [~] Muistutukset: muistutuslista (CSV) mittareista, joilta lukema puuttuu; lähetys odottaa tekstiviestipalvelua (BLOCKERS 2)
- [x] Kierroksen lukulista: lukemien massakirjaus toimistolle ja mittarinlukijalle
- [x] Mittarin tietojen muokkaus (numero, lukutapa, sijainti, kerroin)
- [x] Lukemalomake linkillä ilman kirjautumista (linkit CSV:nä kierrokselta)

### Laskutus (Joutsa vko 50, Kärkinen aloituksen mukaan)
- [x] Toteutuneen kulutuksen laskutus (Joutsa): laskentamoottori, vertailu Fennoan laskuihin (853 täsmää) ja laskutusajo tarkistuksineen
- [x] Loppulasku omistajanvaihdoksessa (vaihtopäivän lukemalla laskutusajo jakaa laskun)
- [~] Arviolasku ja vuositasaus (Kärkinen): laskenta ja laskutusajot valmiit; käytäntöjen vahvistus auki (BLOCKERS 10)
- [x] Kärkisen rekisteri, hinnasto, kiinteistön maksut ja lainaosuudet ennakkolistasta (0014): syyskuun 2026 arviolaskut täsmäävät listaan 160/160 (`npm run karkinen:tuo`, `npm run karkinen:vertaa`)
- [x] Kärkisen asiakastiedot: laskutusosoitteet, verkkolaskuosoitteet ja sopimusten alkupäivät rekistereistä (`npm run karkinen:taydenna`)
- [ ] Laskujen vienti Fennoaan (testiympäristöön, ei tuotantoon)

### Käyttöönotto (maalis–huhtikuu 2027)
- [ ] Syyskuun 2026 laskujen uudelleenlaskenta ja vertailu (tammikuu 2027)
- [ ] Fennoan testiympäristön pääsy (ennen joulukuuta)
- [ ] Rinnakkaisajo mittarilukema.fi:n kanssa maaliskuun 2027 laskutuksessa, tulosten vertailu
- [ ] Siirtyminen, domainin mittarilukema.fi uudelleenohjaus
