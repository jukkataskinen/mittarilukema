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
