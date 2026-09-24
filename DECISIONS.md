# Mittarilukema – DECISIONS

## 2026-09-24

**Oma ohjelmisto, ei valmisohjelmaa.** Nykyinen mittarilukema.fi on Jukan omistama. Sen käyttöliittymä on huono, ja sitä kehitetään käsin koodaten hitaasti ja kalliisti. Uusi ohjelma korvaa sen. Pino on sama kuin eRapussa: GitHub, Supabase ja Vercel. Tiedostot pidetään GitHubissa eikä vain omalla koneella, koska tapa on toiminut eRapussa hyvin.

**Oma Supabase-projekti.** Kasamaster, metsäsovellus ja adepta-ppr jakavat Supabase-projektin `skog`. 3.9.2026 huomattiin, että yhden sovelluksen julkinen avain avasi myös naapurisovellusten tiedot. Tässä ohjelmassa on noin 1150 ihmisen nimet, osoitteet ja kulutustiedot, joten sillä on oltava oma projekti, jota mikään muu sovellus ei avaa.

**Kaksi laskutustapaa asetuksena.** Joutsa laskuttaa toteutuneen kulutuksen mukaan maalis- ja syyskuussa. Kärkinen lähettää arviolaskun kuukausittain ja tasauslaskun kerran vuodessa. Tapa on organisaation asetus eikä kiinteä koodi, ja se voi poiketa kiinteistökohtaisesti. Näin Kärkinen voi siirtyä toteutuneen kulutuksen laskutukseen sitä mukaa kuin etäluettavia mittareita asennetaan, eikä ohjelmaa tarvitse muuttaa. Arvio perustuu oletuksena edellisen vuoden toteutuneeseen kulutukseen, ja uudelle liittymälle se annetaan käsin.

**Laskut Fennoaan.** mittarilukema.fi tekee laskut Fennoaan, ja uusi ohjelma jatkaa samoin. Testilaskuja ei tehdä Fennoan tuotantoon, koska aineiston poistaminen kasvattaa laskutettavaa määrää.

**Lukemat tekstiviestillä, asiakkaalle tuttu tapa säilyy.** Joutsan asiakkaat ilmoittavat mekaanisten mittarien lukemat jo nyt tekstiviestillä. Numero ja palvelu siirretään uuteen järjestelmään, jotta asiakkaan ei tarvitse huomata vaihdosta. Linkillä avautuva lukemalomake ilman kirjautumista on lisävaihtoehto. Linkki koskee yhtä mittaria yhdellä lukukierroksella eikä avaa pääsyä muihin tietoihin. Sama tekstiviestipalvelu voi hoitaa myös eRapun viestit (eRapun BLOCKERS 7).

**Tuotantoon ei kosketa.** mittarilukema.fi pysyy käytössä, kunnes uusi ohjelma on testattu rinnakkain. Tiedot siirretään varmuuskopiosta kopioon.

## 2026-09-24 (runko)

**Runko eRapun pohjalta.** Next.js 15, React 19, Tailwind 4, TypeScript, zod, Vitest. Tietokantakerros, lomakeapurit, muotoilut ja käyttöliittymän osat kopioitiin eRapusta, joten ulkoasu ja koodin tapa ovat samat. Taulujen etuliite on `ml_`.

**Kanta vain palvelimelta, RLS todellisena suojana.** Selaimeen ei anneta Supabasen avaimia. Jokainen käyttäjän pyyntö ajetaan transaktiossa roolilla `authenticated` ja käyttäjän tunnisteella, joten organisaatioiden eristys ei ole koodin varassa. `skog`-projektin vuoto ei voi toistua tällä rakenteella. Eristys testataan jokaiselle taululle.

**Supabase Irlannissa, yhteys jaetun poolerin kautta.** Projekti on alueella eu-west-1. Yhteys kulkee IPv4-poolerin kautta (transaktiotila, portti 6543), koska suora osoite toimii vain IPv6-verkossa. Migraatiot ajetaan saman palvelimen session-tilassa (5432). Vercelin funktiot ovat Dublinissa (dub1), lähellä kantaa.

**Kehityksessä paikallinen kanta.** Kehitys ja testit käyttävät PGliteä, vaikka `.env.local`:ssa on Supabasen osoite. Demodata ja kokeilut eivät päädy oikeaan kantaan vahingossa. Supabasea käytetään vain, jos `DB_DRIVER=postgres` tai sovellus ajetaan Vercelissä.

**Roolit: pääkäyttäjä, toimisto ja mittarinlukija.** Pääkäyttäjä muuttaa asetuksia. Toimisto ylläpitää rekisteriä, hintoja ja lukemia. Mittarinlukija näkee rekisterin ja kirjaa lukemia omissa nimissään, mutta ei hyväksy niitä.

**Poikkeava lukema jää tarkistettavaksi.** Lukema tarkistetaan, jos se on pienempi kuin edellinen, jos kulutus on yli 300 m³ tai jos päiväkulutus on yli kolminkertainen edelliseen jaksoon verrattuna (vähintään 20 m³). Pientä kulutusta ei merkitä, koska vapaa-ajan asunnoilla se on tavallista. Toimiston uusi lukema samalle päivälle korvaa aiemman.

**Kiinteistöllä yksi maksaja kerrallaan.** Kannan rajoite estää kaksi päällekkäistä laskutettavaa sopimusta. Omistajanvaihdoksessa edellinen sopimus päätetään uuden alkua edeltävään päivään.

**Asiakastiedostot eivät kuulu repoon.** Tuontiskripti lukee CSV-tiedoston paikaltaan ja tulostaa vain määrät. `.gitignore` estää CSV-tiedostot, ja CI hylkää repon, jossa on asiakastiedoston näköinen tiedosto.

**Auth0: oma sovellus eRapun tenantissa.** Alun perin päätettiin oma tenantti, mutta Auth0:n tenanttiraja olisi vaatinut maksullisen tason. Mittarilukema saa oman sovelluksen eRapun EU-tenanttiin `erappu`. Tämä riittää, koska käyttöoikeudet ratkaistaan Mittarilukeman omassa kannassa (`ml_org_members`): jaettu tenantti jakaa vain kirjautumistunnukset, ei tietoja. eRapun käyttäjä ei näe Mittarilukemassa mitään ennen kuin hänet lisätään organisaatioon. Vain henkilökunta kirjautuu (salasana ja MFA, kuten eRapun henkilökunta).

**Mittarityyppi mittarinumerosta (Joutsa).** Kolmemerkkinen mittarinumero on vanha mekaaninen mittari, pidempi numero (voi sisältää kirjaimia) uusi etäluettava. Tieto on Jukalta 24.9.2026. Fennoan laskuilla ei ole mittarinumeroita, joten laskuista tuoduilla mittareilla lukutapa on vielä mekaaninen oletuksena. Lukutapa korjataan mittarilukema.fi:n varmuuskopiosta funktiolla `meterReadMethod`.

**Fennoan laskuaineisto rekisterin pohjaksi.** Käyttöpaikan tunnus Unes (viisi numeroa) on kiinteistön pysyvä tunnus vanhassa järjestelmässä, ja se tallennetaan `legacy_id`:ksi. Varmuuskopion tuonti yhdistää tiedot tällä tunnuksella. Toukokuun 2026 laskuilla on 387 mittarinvaihtoa.

## 2026-09-25

**Käyttäjä tunnistetaan varmennetulla sähköpostilla.** Pääkäyttäjä lisätään kantaan ennen ensimmäistä kirjautumista (`npm run kayttaja:lisaa`). Kun Auth0 on varmentanut saman sähköpostiosoitteen, käyttäjä yhdistetään esilisättyyn riviin. Samalla tavalla toimii mahdollinen myöhempi siirto omaan Auth0-tenanttiin, jossa tunnisteet vaihtuvat. Varmentamatonta osoitetta ei yhdistetä, jottei tunnusta voi kaapata rekisteröimällä saman osoitteen.

**MFA omalla Actionilla.** eRapun MFA-Action koskee vain eRapun sovellusta, joten Mittarilukemalle tehdään tenanttiin oma post-login Action. eRapun Actionia ei muuteta, koska eRapun asetusskripti kirjoittaa sen uudelleen. eRapun asetusskripti kieltäytyy nyt ajamasta, koska tenantissa on Mittarilukeman sovellus. Se korjataan eRapun repossa erikseen.

**Perusmaksuluokat ja Joutsan hinnasto.** Perusmaksu määräytyy liittymän luokasta: omakotitalo ja vapaa-ajan asunto, DN20, DN25, DN32, DN40, DN50 tai DN65 (0006). Joutsan hinnasto on julkinen (joutsanvesihuolto.fi/perus-ja-kayttomaksut). Kauden 1.9.2024–30.9.2026 verottomat hinnat otettiin Fennoan laskuilta, koska ne ovat laskutuksen todellinen peruste: DN25:n jätevesi on laskuilla 29,23 €, vaikka verollisesta hinnasta laskettuna se olisi 29,24 €. Liittymien luokat pääteltiin laskuilla veloitetusta perusmaksusta.

**Laskentamoottori (src/lib/billing/calculate.ts).** Kulutus lasketaan mittareittain: jakson loppua lähimmän lukeman (60 päivän ikkuna) ja sitä edeltävän lukeman erotus kerrottuna kertoimella. Jäteveden määrä on vesimittarin mukainen. Perusmaksu lasketaan kuukausittain liittymän voimassaolon ajalta. Hinnanmuutoksessa kesken jakson perusmaksu määräytyy kuukauden alun hinnasta ja käyttömaksu jaetaan päivien suhteessa. Vertailussa Joutsan vuoden 2026 Fennoa-laskuihin 853 laskua täsmäsi sentilleen. Jäljelle jääneet erot olivat vanhan järjestelmän poikkeuksia: vajaat jaksot, useampi lasku samalta jaksolta ja sisäisesti ristiriitaiset laskut.

**Jaksottomat lukemat saavat laskun ajankohdan jakson.** Fennoan laskujen lukemariveistä noin 790:ltä puuttuu jakso. Toukokuun laskuilla jakso on 30.9.2025–31.3.2026 ja elokuun Rutalahden laskuilla 31.12.2025–30.6.2026 (JOUTSA_PERIOD_BY_INVOICE_MONTH).

**Laskutusajo (0007).** Laskutusajo laskee jakson laskut ja tallentaa ne tarkistettaviksi. Maksaja on jakson lopussa voimassa olevan laskutettavan sopimuksen asiakas. Maksajan vaihtuminen kesken jakson jää huomautukseksi, eikä laskua jaeta automaattisesti. Loppulasku tehdään erikseen, ja laskun voi jättää pois ajosta. Luonnoksen voi poistaa ja laskea uudelleen. Hyväksytty ajo lukitaan tietokannan tasolla. Vientiä Fennoaan ei ole, ja mitään ei lähetetä ennen kuin siitä erikseen päätetään (Jukka 25.9.2026).

**Laskutusajon rajaus alueittain.** Ajo tehdään kaikille kiinteistöille, kiinteistöille ilman aluetta tai yhdelle alueelle. Joutsassa Rutalahti laskutetaan eri jaksolla (31.12.–30.6.) kuin Joutsa ja Leivonmäki (30.9.–31.3.).

**Negatiivista kulutusta ei laskuteta.** Jos lukema on pienempi kuin edellinen, kulutukseksi lasketaan 0 ja laskulle jää huomautus. Näin virheellisestä lukemasta ei synny hyvitystä.

**Joutsan alueet Unes-tunnuksesta.** Kiinteistön alue on käyttöpaikan tunnuksen ensimmäinen numero 1–9 (Jukka 25.9.2026). Alue 9 on sama joukko kuin Rutalahti (68 kiinteistöä) ja säilyttää nimensä, koska sen hinnat on sidottu alueeseen. Muut alueet ovat nimillä Alue 1–Alue 8 siihen asti, kun oikeat nimet tiedetään; nimen voi vaihtaa asetuksissa. Laskutusajossa on rajaus kaikki paitsi alue (0009), ja Joutsan pääajo on kaikki paitsi Rutalahti.

**Lukemalinkit (0010).** Kierroksen jokaiselle käytössä olevalle mittarille luodaan satunnainen linkki (24 tavua). Kantaan tallennetaan vain linkin sha256-tiiviste, joten linkit ladataan CSV-tiedostona samalla kertaa, kun ne luodaan, ja uusi lataus korvaa aiemmat. Lomake näyttää vain laitoksen, kiinteistön osoitteen, mittarinumeron ja edellisen lukeman. Linkki toimii, kunnes kierros suljetaan tai määräpäivästä on kulunut 14 päivää. Saman linkin kautta voi korjata lukeman; korjaus hylkää edellisen ilmoituksen. Lukema tarkistetaan kuten muutkin, eli poikkeava lukema jää tarkistettavaksi.
