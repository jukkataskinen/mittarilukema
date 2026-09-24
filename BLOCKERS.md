# Mittarilukema – BLOCKERS

Asiat, jotka odottavat tietoa tai päätöstä.

1. **mittarilukema.fi:n varmuuskopio.** Jukka pyytää (24.9.2026). Tarvitaan tietokannan rakenne ja tiedot: asiakkaat, kiinteistöt, mittarit ja lukemahistoria. Varmuuskopio ei mene gittiin, koska siinä on henkilötietoja.
2. **Tekstiviestipalvelun tarjoaja.** Jukka tarkistaa (24.9.2026). Selvitettävä palveluntarjoaja, numero ja se, miten saapuvat viestit välitetään eteenpäin.
3. **Kärkisten lainaosuus.** Miten se lasketaan: kiinteä summa osuutta kohden, korko, kertamaksun mahdollisuus?
4. **Etäluettavat mittarit.** Selvitettävä valmistaja ja järjestelmä sekä se, tuleeko data tiedostona vai rajapinnan kautta. Koskee Joutsaa nyt ja Kärkistä tulevaisuudessa.
5. **Laskujen lähetyskanavat.** Selvitettävä, lähtevätkö laskut verkkolaskuina, e-laskuina vai paperilla. Todennäköisesti Fennoan kautta kuten nyt.
6. **Kirjautuminen (Auth0).** Päätetty: oma sovellus eRapun tenanttiin (DECISIONS 24.9.2026). Jukka luo sovelluksen (24.9.2026). Odottaa tunnuksia `.env.local`:iin ja Verceliin sekä Vercelin tuotanto-osoitetta. Siihen asti tuotannossa ei voi kirjautua.
7. **Asiakasluettelon alkuperä.** `asiakkaat.csv` (857 riviä) tuotiin paikalliseen kantaan organisaatiolle Joutsan Vesihuolto Oy. Varmistettava, että luettelo on Joutsan. Tiedostossa ei ole asiakasnumeroa eikä kiinteistötietoa, joten asiakkaat yhdistetään kiinteistöihin vasta varmuuskopiosta (BLOCKERS 1). Kuusi riviä oli tiedostossa kahdesti.
