# Mittarilukema – DECISIONS

## 2026-09-24

**Oma ohjelmisto, ei valmisohjelmaa.** Nykyinen mittarilukema.fi on Jukan omistama. Sen käyttöliittymä on huono, ja sitä kehitetään käsin koodaten hitaasti ja kalliisti. Uusi ohjelma korvaa sen. Pino on sama kuin eRapussa: GitHub, Supabase ja Vercel. Tiedostot pidetään GitHubissa eikä vain omalla koneella, koska tapa on toiminut eRapussa hyvin.

**Oma Supabase-projekti.** Kasamaster, metsäsovellus ja adepta-ppr jakavat Supabase-projektin `skog`. 3.9.2026 huomattiin, että yhden sovelluksen julkinen avain avasi myös naapurisovellusten tiedot. Tässä ohjelmassa on noin 1150 ihmisen nimet, osoitteet ja kulutustiedot, joten sillä on oltava oma projekti, jota mikään muu sovellus ei avaa.

**Kaksi laskutustapaa asetuksena.** Joutsa laskuttaa toteutuneen kulutuksen mukaan maalis- ja syyskuussa. Kärkinen lähettää arviolaskun kuukausittain ja tasauslaskun kerran vuodessa. Tapa on organisaation asetus eikä kiinteä koodi, ja se voi poiketa kiinteistökohtaisesti. Näin Kärkinen voi siirtyä toteutuneen kulutuksen laskutukseen sitä mukaa kuin etäluettavia mittareita asennetaan, eikä ohjelmaa tarvitse muuttaa. Arvio perustuu oletuksena edellisen vuoden toteutuneeseen kulutukseen, ja uudelle liittymälle se annetaan käsin.

**Laskut Fennoaan.** mittarilukema.fi tekee laskut Fennoaan, ja uusi ohjelma jatkaa samoin. Testilaskuja ei tehdä Fennoan tuotantoon, koska aineiston poistaminen kasvattaa laskutettavaa määrää.

**Lukemat tekstiviestillä, asiakkaalle tuttu tapa säilyy.** Joutsan asiakkaat ilmoittavat mekaanisten mittarien lukemat jo nyt tekstiviestillä. Numero ja palvelu siirretään uuteen järjestelmään, jotta asiakkaan ei tarvitse huomata vaihdosta. Linkillä avautuva lukemalomake ilman kirjautumista on lisävaihtoehto. Linkki koskee yhtä mittaria yhdellä lukukierroksella eikä avaa pääsyä muihin tietoihin. Sama tekstiviestipalvelu voi hoitaa myös eRapun viestit (eRapun BLOCKERS 7).

**Tuotantoon ei kosketa.** mittarilukema.fi pysyy käytössä, kunnes uusi ohjelma on testattu rinnakkain. Tiedot siirretään varmuuskopiosta kopioon.
