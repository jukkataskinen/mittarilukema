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

**Negatiivinen kulutus hyvitetään enintään 50 m³ (korjattu 26.9.2026).** Jos lukema on pienempi kuin edellinen enintään 50 m³, erotus vähennetään kulutuksesta kuten vanhassa järjestelmässä (edellinen lukema oli liian suuri); 17 Fennoan laskua vastaa tätä. Suurempi miinus (tuotannossa −369, −3 439 ja −7 018 m³) on kirjaamaton mittarinvaihto tai näppäilyvirhe: kulutukseksi lasketaan 0. Kumpikin jää laskulle huomautukseksi. Ensimmäinen päätös (aina 0) laskutti liikaa, toinen (aina hyvitys) olisi tuottanut kymmenien tuhansien eurojen virheelliset hyvitykset.

**Joutsan alueet Unes-tunnuksesta.** Kiinteistön alue on käyttöpaikan tunnuksen ensimmäinen numero 1–9 (Jukka 25.9.2026). Alue 9 on sama joukko kuin Rutalahti (68 kiinteistöä) ja säilyttää nimensä, koska sen hinnat on sidottu alueeseen. Muut alueet ovat nimillä Alue 1–Alue 8 siihen asti, kun oikeat nimet tiedetään; nimen voi vaihtaa asetuksissa. Laskutusajossa on rajaus kaikki paitsi alue (0009), ja Joutsan pääajo on kaikki paitsi Rutalahti.

**Lukemalinkit (0010).** Kierroksen jokaiselle käytössä olevalle mittarille luodaan satunnainen linkki (24 tavua). Kantaan tallennetaan vain linkin sha256-tiiviste, joten linkit ladataan CSV-tiedostona samalla kertaa, kun ne luodaan, ja uusi lataus korvaa aiemmat. Lomake näyttää vain laitoksen, kiinteistön osoitteen, mittarinumeron ja edellisen lukeman. Linkki toimii, kunnes kierros suljetaan tai määräpäivästä on kulunut 14 päivää. Saman linkin kautta voi korjata lukeman; korjaus hylkää edellisen ilmoituksen. Lukema tarkistetaan kuten muutkin, eli poikkeava lukema jää tarkistettavaksi.

**Tekstiviestilukemat (0011).** Vastaanotto on palveluriippumaton: reitti /api/sms/inbound ottaa vastaan lähettäjän, vastaanottajan ja viestin, ja se on suojattu jaetulla salaisuudella. Vastaanottajanumero kertoo organisaation (ml_organizations.sms_number), lähettäjän numero asiakkaan. Lukema kirjataan automaattisesti vain, kun asiakkaalla on yksi käytössä oleva mittari tai viestissä on kiinteistön käyttöpaikan tunnus ("40960 1234"). Muut viestit jäävät Tekstiviestit-välilehdelle toimiston käsiteltäviksi. Kaikki viestit tallennetaan. Vastausviesti muodostetaan, mutta lähetys on testitilassa, kunnes palveluntarjoaja on valittu (BLOCKERS 2).

**Loppulasku omistajanvaihdoksessa (0012).** Jos laskutettava maksaja vaihtuu kesken jakson ja mittarilta on lukema vaihtopäivän tienoilta (±14 päivää), laskutusajo tekee edelliselle maksajalle loppulaskun vaihtopäivään asti ja uudelle maksajalle laskun siitä eteenpäin. Kulutus jaetaan lukemasta ja perusmaksukuukaudet sopimusten päivistä. Laskun lisätiedon alkuun tulee sen oma jakso. Jos vaihtopäivän lukema puuttuu, lasku tehdään yhtenä uudelle maksajalle ja siihen jää huomautus; lukeman kirjaamisen jälkeen ajo lasketaan uudelleen.

**Arviolaskutus ja tasaus (0013), oletuksin.** Laskutusajolla on laji: toteutunut kulutus, arviolasku tai tasaus. Arviolasku: jakson kuukausien perusmaksut ja arvioitu kulutus, joka on vuosikulutusarvio kerrottuna kuukausien osuudella vuodesta. Vuosikulutusarvio lasketaan enintään 400 päivän lukemista (vähintään puolen vuoden jakso), ja muuten käytetään kiinteistölle annettua arviota. Tasaus: jakson todellinen kulutus miinus jakson hyväksytyillä arviolaskuilla laskutettu määrä, ilman perusmaksuja; negatiivinen erotus hyvitetään. Lisäperusmaksu ja lainaosuus laskutetaan kuukausittain kaikissa laskuissa, jos niille on hinta (vuosihinta kuukauden osuutena). Nämä ovat oletuksia, jotka Kärkisten on vahvistettava (BLOCKERS 10).

**Kärkinen ennakkolistasta (0014).** Kärkisen rekisteri ja hinnasto tuodaan syyskuun 2026 ennakkotavoitelistasta, joka kertoo, mitä osakkailta oikeasti veloitetaan kuukausittain. Jokainen listan huoneisto on laskutuskohde, ja asiakasnumero on huoneiston numero. Kuukausilaskujen viitenumero näyttää muodostuvan samasta numerosta (86210 70000 01001 = huoneisto 1), mutta tasauslaskuilla numerointi poikkeaa, joten viitenumeroa ei johdeta siitä. Käyttöpaikat-taulukosta tulevat kulutuspisteen numero ja yhteystiedot (139/160 yhdistetty osoitteella tai nimellä). Laskutusajon arviolaskut täsmäävät listaan kaikilla 160 huoneistolla (29 146,51 €).

**Perusmaksu 2 on etäluettavien mittarien hankintaan liittyvä maksu (Jukka 25.9.2026).** Ensin oletettiin lisäperusmaksuksi; nimi korjattu laskulle muotoon "Perusmaksu 2 (etäluettavat mittarit)". Se veloitetaan vain 142 huoneistolta, joten se on kiinteistön oma maksu (ml_property_charges) eikä hinnaston rivi. Samaan tauluun tulevat liittymän lisämaksu (72 €/kk, alv 0), toinen perusmaksu samalla huoneistolla ja jäsenmaksu kertamaksuna.

**Kärkisen hinnat ovat verollisia.** Rivin summa on määrä × verollinen hinta, ja veroton osuus lasketaan siitä taaksepäin senteille (vanhan järjestelmän tapa). Näin laskun loppusumma täsmää sentilleen. Joutsan verottomien hintojen laskenta ei muutu. Pyöristys on puolikkaat poispäin nollasta; aiempi pyöristys vei 1,285:n alaspäin, ja korjaus nosti myös Joutsan täsmäävät laskut 853:sta 854:ään.

**Lainaosuus saldosta (BLOCKERS 3 ratkaistu).** Lainaosuudesta tallennetaan saldo tiettynä päivänä, kuukausilyhennys ja korko 5 %. Kuukauden korko on kuun alun saldo × 5 % / 12 senteille. Viimeisenä kuukautena jäljellä oleva saldo peritään kuukausierän lisäksi omana rivinään. Pohjana on Lainaosuudet-taulukon saldo 31.8.2026. Lainaosuus ilman kuukausierää jää huomautukseksi eikä sitä laskuteta.

**Perusmaksu kiinteistöä kohden.** Kärkisessä perusmaksu peritään kerran kiinteistöltä, vaikka sillä on vesi- ja jätevesiliittymä. Perusmaksu on jätevesiliittymällä (luokka okt) ja vesiliittymän luokka on `none`. Organisaation `estimate_basis = manual` tarkoittaa, että kiinteistölle annettu arvio menee edellisen vuoden kulutuksen edelle, koska Kärkinen päättää kuukausiarviot itse.

**Kärkisen asiakastiedot rekistereistä.** Asiakasrekisteristä, sidoksista ja verkkolaskuosoitteista täydennetään maksajan laskutusosoite (145/160), puuttuva sähköposti ja puhelin, verkkolaskuosoite (74) sekä sopimuksen alkupäivä ja lisätiedot (`npm run karkinen:taydenna`). Sidos yhdistetään huoneistoon osoitteella, henkilö maksajan nimellä. Sopimuksen alkupäivä on sidoksen voimassaolon alku, useimmiten 31.12.2024, joka on todennäköisesti Kärkisen rekisterin perustamispäivä eikä omistuksen alku. Lisähenkilö (yhteisomistaja) kirjataan sopimuksen lisätietoihin eikä omaksi asiakkaakseen, koska laskutetaan yhtä maksajaa. Vapaatekstistä poistetaan henkilötunnuksen näköiset merkkijonot.

**Kärkisen tasauskäytäntö vanhoista laskuista (BLOCKERS 10 osin ratkaistu).** Vuoden 2025 tasauslaskut (61 kpl, päivätty 21.4.2026) kertovat käytännön: tasausjakso on kalenterivuosi ja lasku lähtee huhtikuussa. Laskulla on toteutunut kulutus omina riveinään ("Kulutusmaksu vesi", "Kulutusmaksu jätevesi") ja arviolaskuilla laskutettu summa euroina vähennyksenä ("Vesi arvio", "Jätevesi arvio"). Perusmaksuja ei ole. Liikaa laskutettu näkyy laskulla hyvityksenä ("Ei maksettavaa", 47 laskua 61:stä). Tasaus tehdään nyt samoin: vähennys on hyväksytyillä arviolaskuilla laskutettu euromäärä liittymälajeittain eikä m³ × nykyinen hinta, joten kesken vuoden tullut hinnankorotus ei vääristä sitä. Uudelleen laskettuna 56/57 yhdistettyä tasauslaskua täsmää sentilleen; ainoalla erolla (huoneisto 30) on erillinen jätevesimittari, jota malli ei vielä tue.

**Kärkisen hintahistoria.** Hinnat nousivat 15 % 27.2.2026 alkaen (hallituksen päätös 15.1.2026): perusmaksu 44,67 → 51,36 €/kk, vesi 2,23 → 2,57 €/m³, jätevesi 2,85 → 3,28 €/m³. Vanhat hinnat ovat hinnastossa 1.1.2025–26.2.2026. Perusmaksu 2 (etäluettavat mittarit) ei ole tammi-, maalis- eikä toukokuun 2026 laskuilla, joten se alkaa syyskuusta 2026.

**Kärkisen mittarit ja lukemat tasauslaskuilta.** Tasauslaskun kulutusrivin alla on vuoden alku- ja loppulukema. Niistä tuodaan kiinteistölle mittari (numero ei tiedossa) ja lukemat 31.12.2024 ja 31.12.2025 (56 mittaria). Liittymän alkupäivä on huoneiston ensimmäisen sidoksen alkukuukausi, ja jos tasauslaskulla ei ole jätevesi- tai vesiriviä, sen liittymän katsotaan alkaneen vasta tasausvuoden jälkeen (huoneistot 57 ja 155). Kuukausilaskujen vertailussa (tammi-, maalis- ja toukokuu 2026) erot selittyvät Kärkisen muuttamilla kuukausiarvioilla ja lainaosuuksilla, joiden laskenta alkaa saldosta 31.8.2026.

**Kärkisen ennakot ja saatavat.** Vanhan järjestelmän raporteista (28.8.2025–31.8.2026) näkyy, että tasauksen hyvitys jää asiakkaalle ennakoksi (4/2026 60 kpl, 8 712 €) ja kuittautuu seuraavista kuukausilaskuista (5/2026 38 kpl). Kuukausilaskulla ennakkoa ei vähennetä, joten Mittarilukeman lasku on aina täysi ja kuittaus kuuluu reskontraan. Reskontra on Fennoassa, jonne laskut viedään myös Kärkisellä (Jukka 25.9.2026). Fennoa-vientiä ei vielä ole, joten lokakuun 2026 laskut lähetetään vielä vanhalla järjestelmällä ja Mittarilukema laskee ne rinnakkain (yhteenveto data/private/raportit/Karkinen_lokakuu_2026_valmius.docx).

## 2026-09-25 (Fennoa-vienti)

**Laskujen vienti Fennoaan (0015, src/lib/fennoa).** Hyväksytyn laskutusajon laskut viedään Fennoaan luonnoksiksi (sales_api/add), ja ne hyväksytään ja lähetetään Fennoassa. Vienti on erissä (25 laskua, Fennoan raja 5 pyyntöä sekunnissa) ja jatkuu siitä, mihin jäätiin. Tila on omassa taulussaan ml_fennoa_exports, koska hyväksytty ajo on lukittu. Laskut varataan ennen Fennoa-kutsua, joten sama lasku ei lähde kahdesti. Kesken jäänyt tai poikkeava vienti ei lähde uudelleen ilman tarkistusta. Tilat FENNOA_MODE=mock (oletus) ja test (testiyrityksen tunnukset). Tuotantoon vientiä ei ole kytketty, koska Fennoan tuotantoon luotuja laskuja ei voi poistaa. Kentät on otettu Fennoan dokumentaatiosta (tietopankki.fennoa.com/api-sales-invoices) ja Kasamasterin toimivasta integraatiosta. Verolliset hinnat viedään parametrilla include_vat=1. Negatiivinen lasku, esimerkiksi tasauksen hyvitys, viedään hyvityslaskuna. Tasauksen vähennysrivi viedään yhtenä eränä, jos määrä × hinta ei anna tarkkaa summaa.

**Laskukanava asetetaan eksplisiittisesti eikä sille ole oletusta (Jukka 25.9.2026).** Toisessa projektissa asiakkaalle kerrottiin sähköpostilaskusta, mutta lasku lähti postitse, koska puuttuva kanava muuttui oletuksena paperiksi. Siksi:
1. Kanava on asiakkaan tieto (invoice_channel), ja sen lähde kirjataan (tuonti tai toimisto).
2. Kanavan tiedot tarkistetaan tallennettaessa ja ennen vientiä: sähköpostilasku vaatii sähköpostiosoitteen, e-lasku ja suoramaksu tilinumeron ja BIC:n, verkkolasku OVT:n ja välittäjän, ja kaikki vaativat postiosoitteen, koska Fennoa vaatii sen.
3. Puutteellinen lasku estetään, eikä sitä lähetetä toista kautta.
4. Fennoan toimitustapa asetetaan jokaiselle laskulle erikseen: postal, email, finvoice, consumerfinvoice tai consumerdirect.
5. Lasku luetaan Fennoasta takaisin. Jos kanava tai summa eroaa, lasku merkitään poikkeamaksi ja se korjataan Fennoassa ennen lähetystä.

**Kärkisen laskukanavat.** Kanava asetetaan vain vanhan järjestelmän verkkolaskuosoitteista: tilinumero ja BIC tarkoittavat kuluttajan e-laskua, OVT-tunnus yrityksen verkkolaskua ja suoramaksusopimus suoramaksua (74 asiakasta). Muille ei arvata paperia eikä sähköpostia, vaan kanava vahvistetaan Kärkiseltä. Kuolinpesä laskutetaan kuluttajana, eikä sitä enää luokitella tuonneissa yhteisöksi.

## 2026-09-25 (Tiedotteet)

**Tiedotteet (0016, src/lib/announcements).** Jokainen organisaatio voi lähettää tiedotteen laskun maksajille tai kaikille voimassa olevien sopimusten osapuolille, koko organisaatiolle tai yhdelle alueelle (Jukka 25.9.2026: Kärkisen osakkaat saavat tiedon laskutuksen muutoksesta). Toimitustapa päätetään säännöllä, joka näytetään ennen lähetystä:
- **Sähköposti ensin:** jos sähköpostia ei ole, kirje.
- **Kaikille kirje:** sähköposti vain, jos postiosoite puuttuu.
- **Ei tavoitettavissa:** kumpaakaan ei voi käyttää. Nämä luetellaan, jotta tiedot voi täydentää.

Vastaanottajat ja osoitteet lukitaan lähetyksen alkaessa, jolloin jälkikäteen näkyy, kuka sai tiedotteen ja miten. Sähköpostit lähtevät erissä (40), ja rinnakkainen painallus ei lähetä samaa viestiä kahdesti. Ennen lukitusta voi lähettää koeviestin omaan osoitteeseen.

**Kirjeet itse tulostettaviin ikkunakuoriin.** Kirjeet tehdään yhdeksi PDF:ksi (pdf-lib, vakiofontti Helvetica). Osoite sijoitetaan SFS 2487:n osoitekenttään: 20 mm vasemmalta ja rivin 8 kohdalle, noin 45 mm ylhäältä. Paikka sopii sekä C5- että E65-ikkunakuoreen. Koetulosteessa ikkunan ohjeellinen paikka ja taitekohdat on merkitty, ja siinä on kuvitteellinen vastaanottaja. Kirjeet merkitään postitetuiksi erikseen tulostuksen jälkeen. Fontista puuttuva merkki korvataan kysymysmerkillä, jottei tulostus kaadu.

**Sähköpostipalvelu Resend, oletuksena testitila.** Kuten tekstiviesteissä, oletus on testitila (EMAIL_MODE=mock), joka ei lähetä mitään. Resend valittiin, koska se on jo käytössä Kasamasterissa ja sen rajapinta on pelkkä HTTPS-kutsu. Lähettäjän nimenä näkyy organisaation nimi, ja vastaukset ohjataan organisaation sähköpostiin (Asetukset, yhteystiedot). Viesteissä ei ole ulkoisia kuvia eikä seurantaa.

**Kirjeet Postitan kautta (Jukka 25.9.2026).** Tiedotteiden kirjeet postittaa Postita.fi. Hinta on 2,34 € (2. luokka) ja 3,27 € (1. luokka) kirjeeltä alv 0, ja se sisältää tulostuksen, isoikkunaisen C5-kuoren ja postimaksun. Kiinteitä maksuja ei ole. Vertailussa netKirje oli 2,60–3,00 €, oma Port Payé -postitus noin 2,10 € ja käsityö päälle, eikä kuorituskone kannata näillä määrillä (arviolta noin 700 kirjettä vuodessa).
- Kirjepohja noudattaa Postitan kirjepohjaohjetta: lähettäjä 10–30 mm, maksumerkinnän kaista 30–40 mm tyhjänä, vastaanottaja 40–60 mm, 20–85 mm vasemmalta ja turva-alue 85 × 110 mm. Pitkä rivi pienennetään mahtumaan kenttään.
- Kirjeet ladataan rajapinnalla (src/lib/letters) yhtenä PDF:nä vahvistamattomana työnä, ja pdf_splitter jakaa sen kirjeiksi (kaikki kirjeet ovat yhtä pitkiä). Vedoksen voi tarkistaa Postitassa ennen kuin postitus vahvistetaan tiedotteen sivulta. Peruutus palauttaa kirjeet lähettämättömiksi.
- Oma tulostus jää varavaihtoehdoksi. Oletuksena on testitila (LETTER_MODE=mock).

**Luonnoksen vienti Fennoan testiympäristöön (Jukka 25.9.2026).** Testitilaan ja Fennoan testiyritykseen voi viedä myös laskutusajon luonnoksen. Näin vientiä voi kokeilla hyväksymättä ajoa: hyväksytty ajo lukitaan, ja Kärkisen hyväksytyt arvioajot vähennetään tasauksessa. Kun luonnos poistetaan, sen vientitiedot poistuvat mukana; testiyrityksen luonnoslaskut jäävät Fennoaan. Tuotantoon viedään jatkossakin vain hyväksytty ajo.

**Hyväksytyn ajon poisto huoltotoimena (0018, Jukka 25.9.2026).** Kärkisen lokakuun 2026 arvioajo hyväksyttiin kokeiluna ennen kuin luonnoksen vienti Fennoan testiin oli mahdollinen. Koska hyväksytyt arvioajot vähennetään tasauksessa, ajo piti poistaa. Lukitusfunktio sallii nyt hyväksytyn ajon poiston, jos transaktioon on asetettu lippu ml.allow_approved_delete eikä kutsua tehdä sovelluksen käyttäjäroolilla. Poisto tehdään skriptillä `npm run laskutus:poista-hyvaksytty`, joka kirjaa syyn muutoslokiin. Muutokset hyväksyttyyn ajoon ovat edelleen estettyjä. Triggerien poistaminen käytöstä ei onnistunut tuotannossa, koska se vaatii taulun omistajan oikeudet, eikä se olisi rajannut poistoa yhtä tarkasti.

**Fennoan laskukanavan varmistus osoitteesta (Jukka 25.9.2026).** Fennoan laskun haku ei palauta toimitustapaa, vaikka dokumentaatio niin väittää. Luonnoksen toimitustapa oli Fennoassa kuitenkin oikein (verkkolasku) ja osoite näkyi. Sähköisen laskun kanava katsotaan siksi varmistetuksi, kun Fennoan tallentama verkkolasku- tai sähköpostiosoite on sama kuin lähetetty, ja tämä kirjataan viennin viestiin. Paperilaskun kanavaa ei voi varmistaa näin, joten se jää poikkeamaksi, kunnes sekin on testattu.

**Kärkisen maksajan nimen jäsennys korjattu.** Ennakkolistan PDF:ssä 66 maksajan nimi on pari pistettä huoneistorivin alapuolella, jolloin nimi jäi tyhjäksi ja asiakkaalle tuli varanimi "Huoneisto N". Nimi haetaan nyt ±4 pisteen etäisyydeltä. Samalla lainaosuuksien kohdistus valitsee usean nimiosuman tai sumean osoiteosuman tapauksessa osoitteeltaan selvästi lähimmän huoneiston: 4 500 euron laina kohdistuu nyt huoneistoon 124 eikä 125.

**Fennoan luonnoksen toimitustapaa ei voi lukea rajapinnasta (25.9.2026).** Kolmas testivienti kirjasi Fennoan vastauksen kenttien nimet. Laskulla on kenttä delivery_method, mutta luonnoksessa se on tyhjä, eikä vastauksessa ole verkkolaskuosoitetta. Luonnoksen toimitustapa oli silti Fennoassa oikein (Jukka tarkisti). Siksi luonnos katsotaan viedyksi, kun Fennoa on hyväksynyt sen annetulla toimitustavalla ja kenttä on tyhjä. Fennoa tarkistaa toimitustavan laskua luodessaan: se hylkäsi kuluttajien e-laskut ilman sopimusta. Viestiin kirjataan tämä ja kehotus tarkistaa muutama lasku pistokokein Fennoassa ennen hyväksyntää. Jos kenttä tai palautettu osoite poikkeaa lähetetystä, lasku on edelleen poikkeama.

## 2026-09-26 (Kärkisen koko aineisto)

**Vanhassa järjestelmässä laskutetut arviot (0019).** Vuoden 2026 tasaus vähentää myös vanhassa järjestelmässä laskutetut kuukausiarviot. Ne luetaan kuukausilaskuilta (tammi-, maalis-, huhti-, touko-, kesä- ja elokuu) ja syyskuun ennakkolistalta (`npm run karkinen:arviot`). Helmi- ja heinäkuulta ei ole laskuja, joten ne päätellään edellisestä kuukaudesta. Päättely on varma, kun arvio on sama molemmin puolin (136/137 ja 147/148). Muuten rivi merkitään tarkistettavaksi, ja tasauslaskulle tulee huomautus. Kuukautta, jolle on myös hyväksytty Mittarilukeman arviolasku, ei lasketa kahdesti.

**Laskun kohdistus kiinteistöön.** Järjestys on osoite, sitten vanhan järjestelmän viitenumero (opitaan osoitteella kohdistetuista laskuista), ja saman tai lähes saman osoitteen tapauksessa laskun vastaanottajan nimi maksajan nimeä vastaan. Näin 920/940 kuukausilaskua kohdistuu (ennen 868). Lähes sama osoite hyväksytään, kun samankaltaisuus on vähintään 0,85 ja se on vähintään 0,05 parempi kuin seuraava.

**Perusmaksu 2 alkoi 1.8.2026.** Maksu on ensimmäisen kerran elokuun 2026 laskuilla (148 kpl), mutta ei kesäkuun laskuilla. Aiempi oletus, 1.9.2026, korjattiin.

**Mittarilukemataulukko 2025.** Kärkisen taulukossa (Aallon Groupille 25.3.2026) on edellinen lukema ja lukema 31.12.2025. Kiinteistöille, joilla ei ollut mittaria tasauslaskulta, perustetaan mittari taulukon lukemilla (46 mittaria). Tasauslaskun mittareilla loppulukema vahvistui 50:ssä ja poikkesi 3:ssa. Kaksi PDF-tiedostoa (Vesitasauslaskut, Tilisiirrot 202609) on lukukelvottomia, koska fonteilta puuttuu merkkikartta. Ne ovat samaa tietoa kuin luettavat tiedostot. "Tilisiirrot syyskuun laskutus" on syyskuun 2025 laskutus.

**PDF-tiedotteet (0020, Jukka 26.9.2026).** Tiedotteet ovat usein valmiita PDF-tiedostoja, joten tiedotteeseen voi liittää yhden PDF:n (enintään 4 Mt ja 50 sivua, ei salasanasuojausta). Kirjoitettu teksti on silloin vapaaehtoinen saate. Tiedotteen lukitseminen vaatii joko tekstin tai liitteen.
- Sähköpostissa PDF on viestin liitteenä. Jos tekstiä ei ole, viestissä kerrotaan, että tiedote on liitteenä.
- Kirjeessä osoitteellinen saatesivu tulee ikkunakuoren kohdalle, ja PDF:n sivut tulevat sen perään A4-kokoon sovitettuina. Postitan raja on 12 sivua kirjettä kohden.
- Tiedosto tallennetaan kantaan (bytea) samojen organisaatiorajausten taakse kuin tiedote. Näin erillistä tiedostopalvelua ei tarvita, ja Vercelin 4,5 Mt:n pyyntöraja riittää.

**Asiakkaan lähetysloki (Jukka 26.9.2026).** Asiakkaan sivulla on "Lähetetyt"-loki, josta näkee, mitä asiakkaalle lähetettiin ja mitä kanavaa pitkin. Mukana ovat tiedotteet (sähköposti tai kirje, itse tulostettu tai Postita) ja laskujen viennit Fennoaan (laskukanava ja viennin tila). Loki kootaan lähetyshetken tiedoista: osoite on se, johon tiedote todella lähti, vaikka asiakkaan tiedot olisivat myöhemmin muuttuneet. Uutta tauluja ei tarvittu, koska vastaanottajat ja viennit tallennetaan jo lähetyshetkellä.

**Useampi sähköpostiosoite.** Kärkisen asiakasrekisterissä samassa kentässä voi olla useampi osoite (tuotannossa 11 asiakkaalla). Tiedote lähtee kaikkiin kelvollisiin osoitteisiin, jotta se ei lähde kirjeenä vain siksi, ettei kenttä ole yksi osoite. Fennoa-laskun sähköpostikanava vaatii edelleen yhden osoitteen, ja muut estetään viennissä.

## 2026-09-26 (Käyttöpaikan osapuolet, Jukka)

**Liittymissopimus ja käyttösopimus (0021).** Käyttöpaikka pysyy, osapuolet vaihtuvat. Omistajan kanssa tehdään liittymissopimus (`role = owner`), vuokralaisen kanssa käyttösopimus (`role = tenant`). Käyttösopimukseen merkitään, mitkä laskun osat vuokralainen maksaa (`tenant_components`, oletuksena kulutus). Omistaja maksaa loput. Käyttöpaikalla voi olla samaan aikaan yksi laskutettava sopimus kumpaakin lajia, joten saman jakson lasku voi jakautua kahdelle. Vanhat vuokralaissopimukset saivat migraatiossa kaikki osat, jotta jo laskutettu käytäntö ei muutu.

**Lainan velallinen.** Lainaosuus laskutetaan omistajalta, ellei lainalle ole kirjattu muuta velallista (`debtor_customer_id`). Omistajanvaihdoksessa kysytään, mitä lainalle tapahtuu. Laina peritään myyjältä, kunnes kauppakirja osoittaa sen siirtyneen ostajalle. Myyjälle tehdään silloin oma lainaosuuden lasku.

**Lukema vaaditaan vaihdoksessa, laskutus vaihtuu seuraavan kuun alusta.** Omistajan ja vuokralaisen vaihdoksessa lukema on pakollinen: kulutus jaetaan vaihtopäivän lukemalla. Kuukausimaksut vaihtuvat vaihtoa seuraavan kuun alusta. Toteutuneen kulutuksen laskussa tämä seuraa kuukauden 1. päivästä. Arviolasku laskutetaan jakson ensimmäisenä päivänä voimassa olevilta osapuolilta, joten vaihtokuukausi kuuluu vielä edelliselle.

**Tasaus osapuolten vaihtuessa.** Tasaus laskutetaan jakson lopun osapuolille, ja laskulle tulee huomautus, jos osapuolet vaihtuivat jaksolla. Arvioiden kohdistus maksajittain tehdään, kun ensimmäinen tällainen tapaus tulee vastaan.

**Omistajanvaihdos ja vuokralaisen vaihdos ohjattuina (vaihe 2).** Vaihdos tehdään omalla lomakkeellaan kiinteistön sivulta, ja kaikki vaiheet tallentuvat samassa transaktiossa: lukemat, sopimusten päättyminen ja alku, lainan velallinen ja tapahtuma. Näin käyttöpaikalle ei jää puolikasta tilaa. Vaihtopäivä on lähtevän osapuolen viimeinen päivä: lukema kirjataan sille, ja uusi sopimus alkaa seuraavana päivänä. Lukema vaaditaan kaikilta vaihtopäivänä käytössä olevilta mittareilta. Jos lukema poikkeaa aiemmista, se jää tarkistettavaksi, ja siitä ilmoitetaan, koska laskutus käyttää vain hyväksyttyjä lukemia.

**Loppulasku seuraavassa laskutusajossa.** Erillistä heti tehtävää loppulaskua ei tehdä. Laskutusajo jakaa jakson vaihtopäivän lukemalla ja tekee lähtevälle oman laskunsa. Näin loppulasku kulkee saman tarkistuksen, hyväksynnän ja Fennoa-viennin läpi kuin muutkin laskut.

**Uusi asiakas vaihdoslomakkeella.** Ostajan tai vuokralaisen voi perustaa suoraan vaihdoslomakkeella, jottei vaihdosta tarvitse keskeyttää. Laskukanavaa ei kysytä siinä: Fennoa-vienti estää laskun, kunnes kanava on asetettu asiakkaan sivulla. Se on sama periaate kuin muillakin asiakkailla.

**Lainan siirron vahvistus.** Kun laina on jäänyt myyjälle, kiinteistön sivulla on painike "Laina siirtynyt omistajalle". Painike poistaa erillisen velallisen, ja siirto kirjataan lokiin. Vuokralaiselle lainaosuus ei siirry koskaan.
