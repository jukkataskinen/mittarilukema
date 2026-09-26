import type { IconName } from "@/components/NavIcon";

/**
 * Ohjesivujen sisältö (/ohjeet). Etusivu esittelee toiminnot, ja se sopii
 * myös myyntiesittelyyn, joten tekstit kertovat ensin hyödyn ja sitten
 * käytön. Sisällössä ei ole asiakastietoja. Kun toiminto muuttuu, päivitä
 * sen ohje samassa muutoksessa.
 */

export interface HelpSection {
  title: string;
  text?: string;
  steps?: string[];
  bullets?: string[];
}

export interface HelpTopic {
  slug: string;
  group: string;
  icon: IconName;
  title: string;
  /** Yhden lauseen hyöty etusivun kortille. */
  summary: string;
  /** Kortin ja ohjeen alun kohokohdat. */
  highlights: string[];
  /** Sovelluksen sivu, josta toiminto löytyy. */
  appPath?: string;
  appLabel?: string;
  sections: HelpSection[];
  tips?: string[];
  related?: string[];
  /** Kehitteillä oleva toiminto: näytetään merkinnällä. */
  upcoming?: boolean;
}

export const HELP_GROUPS = ["Rekisteri ja käyttöpaikat", "Lukemat", "Laskutus", "Viestintä", "Hallinta ja tietoturva"];

export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: "rekisteri",
    group: "Rekisteri ja käyttöpaikat",
    icon: "building",
    title: "Käyttöpaikat, liittymät ja asiakkaat",
    summary: "Yksi selkeä rekisteri: käyttöpaikka pysyy, omistajat, vuokralaiset ja mittarit vaihtuvat sen ympärillä.",
    highlights: [
      "Käyttöpaikalla vesi- ja jätevesiliittymät, mittarit ja sopimukset",
      "Asiakkaalla laskutusosoite, laskukanava ja lähetysloki",
      "Haku osoitteella, asiakkaalla ja mittarinumerolla",
    ],
    appPath: "/kiinteistot",
    appLabel: "Kiinteistöt",
    sections: [
      {
        title: "Rakenne",
        text: "Käyttöpaikka (kiinteistö) on rekisterin perusyksikkö, joka pysyy, vaikka omistaja tai mittari vaihtuu. Käyttöpaikalla on liittymät (vesi, jätevesi), liittymillä mittarit ja mittareilla lukemat. Asiakkaat liittyvät käyttöpaikkaan sopimuksilla.",
      },
      {
        title: "Uuden käyttöpaikan lisääminen",
        steps: [
          "Avaa Kiinteistöt ja valitse Uusi kiinteistö.",
          "Anna osoite, alue ja tarvittaessa kiinteistötunnus. Laskutustapa tulee organisaation asetuksista, ellei kiinteistölle valita poikkeusta.",
          "Lisää kiinteistön sivulla liittymät ja niille mittarit aloituslukemineen.",
          "Kirjaa omistaja liittymissopimuksena. Ilman laskutettavaa sopimusta kiinteistölle ei synny laskua.",
        ],
      },
      {
        title: "Asiakkaat",
        bullets: [
          "Asiakas on henkilö tai yritys. Yritykselle voi tallentaa Y-tunnuksen ja verkkolaskuosoitteen.",
          "Laskukanava (paperi, sähköposti, verkkolasku, e-lasku, suoramaksu) valitaan asiakkaalle, ja sen tiedot tarkistetaan jo tallennettaessa.",
          "Asiakkaan sivulla näkyvät hänen käyttöpaikkansa ja lähetysloki: mitä hänelle on lähetetty ja mitä kanavaa pitkin.",
        ],
      },
    ],
    related: ["omistajanvaihdos", "mittarinvaihto", "laskukanava"],
  },
  {
    slug: "omistajanvaihdos",
    group: "Rekisteri ja käyttöpaikat",
    icon: "key",
    title: "Omistajanvaihdos ja vuokralaiset",
    summary: "Kauppa tai vuokralaisen muutto kirjataan yhdellä ohjatulla lomakkeella, eikä mikään jää puolitiehen.",
    highlights: [
      "Liittymissopimus omistajalle, käyttösopimus vuokralaiselle",
      "Vuokralainen maksaa vain sovitut osat, yleensä kulutuksen",
      "Laina peritään myyjältä, kunnes kauppakirja osoittaa siirron",
    ],
    appPath: "/kiinteistot",
    appLabel: "Kiinteistöt",
    sections: [
      {
        title: "Kaksi sopimusta",
        text: "Omistajan kanssa tehdään liittymissopimus ja vuokralaisen kanssa käyttösopimus. Käyttösopimukseen merkitään, mitkä laskun osat vuokralainen maksaa: kulutusmaksut, perusmaksut tai muut maksut. Omistaja maksaa loput. Saman jakson lasku jakautuu tarvittaessa automaattisesti kahdelle maksajalle.",
      },
      {
        title: "Omistajanvaihdos",
        steps: [
          "Avaa kiinteistö ja valitse Sopimukset-kohdasta Omistajanvaihdos.",
          "Anna vaihtopäivä. Se on myyjän viimeinen päivä, ja ostajan sopimus alkaa seuraavana päivänä.",
          "Valitse ostaja rekisteristä tai perusta uusi asiakas samalla lomakkeella.",
          "Kirjaa vaihtopäivän lukema kaikille mittareille. Lukema on pakollinen, koska sillä kulutus jaetaan myyjän ja ostajan kesken.",
          "Jos käyttöpaikalla on lainaa, valitse, jääkö laina myyjälle vai siirtyykö se ostajalle.",
          "Valitse tarvittaessa, päättyykö vuokralaisen käyttösopimus samalla.",
        ],
      },
      {
        title: "Mitä vaihdoksen jälkeen tapahtuu",
        bullets: [
          "Seuraava laskutusajo tekee myyjälle loppulaskun vaihtopäivään asti ja ostajalle laskun siitä eteenpäin.",
          "Kuukausimaksut vaihtuvat vaihtoa seuraavan kuun alusta.",
          "Jos laina jäi myyjälle, myyjä saa lainaosuudesta oman laskun. Kun kauppakirja osoittaa siirron, valitse kiinteistön sivulla Laina siirtynyt omistajalle.",
          "Vaihdos näkyy kiinteistön tapahtumissa osapuolineen ja lainapäätöksineen.",
        ],
      },
      {
        title: "Vuokralaisen vaihdos",
        steps: [
          "Valitse kiinteistön sivulla Vuokralaisen vaihdos.",
          "Anna vaihtopäivä ja valitse, muuttaako nykyinen vuokralainen pois.",
          "Valitse uusi vuokralainen ja osat, jotka hän maksaa, tai jätä valinta tyhjäksi, jos kyse on vain poismuutosta.",
          "Kirjaa vaihtopäivän lukema.",
        ],
      },
    ],
    tips: [
      "Kaikki vaiheet tallentuvat yhdessä tai ei mitään, joten keskeytynyt kirjaus ei jätä käyttöpaikkaa ristiriitaiseen tilaan.",
      "Jos vaihtopäivän lukema poikkeaa aiemmista, se jää tarkistettavaksi. Hyväksy se ennen laskutusajoa.",
    ],
    related: ["rekisteri", "laskutus"],
  },
  {
    slug: "mittarinvaihto",
    group: "Rekisteri ja käyttöpaikat",
    icon: "wrench",
    title: "Mittarinvaihto ja vaihtokampanja",
    summary: "Yksittäinen vaihto parilla kentällä tai koko etäluentakampanja asentajan listasta kerralla.",
    highlights: [
      "Loppu- ja aloituslukema tarkistetaan ennen kirjausta",
      "Asentajan CSV-lista eräksi: valmiit, korjattavat ja kirjatut",
      "Sama lista voidaan ladata uudelleen ilman kaksoiskirjauksia",
    ],
    appPath: "/mittarinvaihdot",
    appLabel: "Mittarinvaihdot",
    sections: [
      {
        title: "Yksittäinen vaihto",
        steps: [
          "Avaa kiinteistö ja valitse mittarin kohdalta Vaihda mittari.",
          "Anna vaihtopäivä ja vanhan mittarin loppulukema.",
          "Anna uuden mittarin numero, aloituslukema (yleensä 0) ja lukutapa.",
          "Kirjaa vaihto. Vanha mittari poistuu, uusi asennetaan samalle liittymälle, ja vaihto näkyy kiinteistön tapahtumissa.",
        ],
      },
      {
        title: "Vaihtokampanja",
        steps: [
          "Pyydä asentajalta lista, jossa on sarakkeet Vanha mittari, Vaihtopäivä, Loppulukema ja Uusi mittari. Aloituslukema, Käyttöpaikka ja Lukutapa ovat valinnaisia.",
          "Avaa Mittarinvaihdot, anna erälle nimi ja lataa tiedosto. Mitään ei vielä kirjata.",
          "Käy läpi korjattavat rivit. Rivin viesti kertoo syyn, esimerkiksi tuntemattoman mittarinumeron tai edellistä pienemmän loppulukeman.",
          "Korjaa rekisteri tarvittaessa ja valitse Tarkista uudelleen.",
          "Valitse Kirjaa valmiit. Suuri erä kirjataan 150 rivin osissa, joten jatka, kunnes valmiita ei ole jäljellä.",
        ],
      },
      {
        title: "Tarkistukset",
        bullets: [
          "Vaihtopäivä ei ole tulevaisuudessa eikä ennen vanhan mittarin asennusta.",
          "Loppulukema ei ole pienempi kuin edellinen hyväksytty lukema.",
          "Vanhalle mittarille ei ole kirjattu lukemaa vaihtopäivän jälkeen.",
          "Uusi mittarinumero ei ole jo käytössä toisella mittarilla.",
        ],
      },
    ],
    tips: [
      "Laskutus laskee vanhan mittarin kulutuksen loppulukemaan asti ja uuden aloituslukemasta, joten vaihto ei vaadi erillistä lukukierrosta.",
      "Excelistä tallennettu CSV kelpaa sellaisenaan: erottimena voi olla puolipiste, pilkku tai sarkain.",
    ],
    related: ["rekisteri", "lukemat"],
  },
  {
    slug: "aikajana",
    group: "Rekisteri ja käyttöpaikat",
    icon: "calendar",
    title: "Käyttöpaikan aikajana",
    summary: "Käyttöpaikan koko historia yhdellä silmäyksellä: kuka omisti, kuka maksoi, mikä mittari oli käytössä ja mitä laskutettiin.",
    highlights: ["Kaistat omistajista, vuokralaisista ja mittareista", "Vaihdokset päätöksineen", "Lukemat ja hyväksytyt laskut samalla janalla"],
    appPath: "/kiinteistot",
    appLabel: "Kiinteistöt",
    sections: [
      {
        title: "Aikajanan avaaminen",
        steps: [
          "Avaa kiinteistö ja valitse ylhäältä Aikajana.",
          "Kaistoista näet, kuka on ollut omistaja ja vuokralainen ja mikä mittari on ollut käytössä milloinkin. Viemällä osoittimen palkin päälle näet päivämäärät, ja osapuolen palkista pääset asiakkaan sivulle.",
          "Alla on tapahtumajana vuosittain, uusin ensin. Rajaa näkymää välilehdillä: osapuolet, mittarit ja lukemat tai laskut.",
        ],
      },
      {
        title: "Mitä janalla on",
        bullets: [
          "Tapahtumat: omistajanvaihdos, vuokralaisen vaihdos ja mittarinvaihto osapuolineen, lukemineen ja lainapäätöksineen.",
          "Sopimukset ja liittymät, jotka on kirjattu muuten kuin vaihdostoiminnolla.",
          "Lukemat lähteineen (toimisto, asiakkaan ilmoitus, tekstiviesti, etäluenta, tuonti) ja tarkistettavat lukemat.",
          "Hyväksytyt laskut jaksoineen, maksajineen ja summineen. Laskusta pääset laskun tietoihin.",
        ],
      },
    ],
    tips: ["Vaihdostapahtuma kokoaa tekemänsä sopimus- ja mittarimuutokset, joten samaa asiaa ei näy janalla kahteen kertaan."],
    related: ["omistajanvaihdos", "mittarinvaihto"],
  },
  {
    slug: "lukemat",
    group: "Lukemat",
    icon: "droplet",
    title: "Lukukierrokset ja lukemien keruu",
    summary: "Lukemat tulevat asiakkailta linkillä, mittarinlukijalta listalla ja toimistolta suoraan, ja poikkeamat pysähtyvät tarkistettaviksi.",
    highlights: [
      "Henkilökohtainen lukemalinkki asiakkaalle, ei kirjautumista",
      "Lukulista alueittain mittarinlukijalle",
      "Automaattinen tarkistus: pienempi lukema, suuri tai moninkertainen kulutus",
    ],
    appPath: "/lukemat",
    appLabel: "Lukemat",
    sections: [
      {
        title: "Lukukierros",
        steps: [
          "Avaa Lukemat ja luo kierros: nimi, lukemapäivä ja määräpäivä.",
          "Luo kierrokselle lukemalinkit. Linkit voi ladata CSV-tiedostona kirjeisiin tai tekstiviesteihin.",
          "Asiakas avaa linkin ja ilmoittaa lukeman. Sivulla näkyy vain laitos, osoite, mittarinumero ja edellinen lukema.",
          "Kirjaa loput lukemat kierroksen lukulistalle alueittain tai kiinteistön sivulla.",
        ],
      },
      {
        title: "Tarkistukset",
        bullets: [
          "Lukema, joka on pienempi kuin edellinen, jää tarkistettavaksi.",
          "Poikkeuksellisen suuri kulutus (yli 300 m³) jää tarkistettavaksi.",
          "Kulutus, joka on moninkertainen aiempaan verrattuna, jää tarkistettavaksi.",
          "Tarkistettavat lukemat näkyvät työpöydällä, ja ne hyväksytään tai hylätään yhdellä painalluksella.",
        ],
      },
      {
        title: "Tekstiviestit",
        text: "Asiakas voi lähettää lukeman tekstiviestillä, ja viesti kohdistetaan puhelinnumeron perusteella hänen mittariinsa. Tekstiviestipalvelun tarjoaja otetaan käyttöön erikseen.",
      },
    ],
    tips: ["Laskutus käyttää vain hyväksyttyjä lukemia, joten hyväksy tarkistettavat ennen laskutusajoa."],
    related: ["laskutus", "mittarinvaihto"],
  },
  {
    slug: "laskutus",
    group: "Laskutus",
    icon: "registry",
    title: "Laskutusajot",
    summary: "Toteutunut kulutus, kuukausittaiset arviolaskut ja vuositasaus samalla laskentamoottorilla. Jokainen lasku tarkistetaan ennen hyväksyntää.",
    highlights: [
      "Toteutunut kulutus, arviolasku ja tasaus",
      "Maksajan vaihdokset, vuokralaiset ja lainat jaetaan automaattisesti",
      "Huomautukset laskuilla ennen hyväksyntää",
    ],
    appPath: "/laskutus",
    appLabel: "Laskutus",
    sections: [
      {
        title: "Laskutustavat",
        bullets: [
          "Toteutunut kulutus: lukemien välinen kulutus ja perusmaksut, esimerkiksi maalis- ja syyskuussa.",
          "Arviolasku: kuukausittainen lasku vuosikulutusarviosta. Arvio lasketaan edellisen vuoden lukemista tai annetaan käsin.",
          "Tasaus: toteutunut kulutus, josta vähennetään arviolaskuilla jo laskutettu.",
        ],
      },
      {
        title: "Laskutusajo",
        steps: [
          "Avaa Laskutus ja valitse jakso, laji ja rajaus (kaikki, alue tai kaikki paitsi alue).",
          "Laske laskut. Ajo on luonnos, jonka voi poistaa ja laskea uudelleen.",
          "Käy läpi laskut, joilla on huomautuksia, esimerkiksi puuttuva lukema tai maksajan vaihdos ilman vaihtopäivän lukemaa.",
          "Jätä tarvittaessa yksittäinen lasku pois ajosta.",
          "Hyväksy ajo. Hyväksytty ajo lukitaan, eikä sitä voi enää muuttaa.",
          "Vie hyväksytyt laskut Fennoaan.",
        ],
      },
      {
        title: "Hinnasto ja kiinteistön maksut",
        bullets: [
          "Hinnastossa ovat käyttö- ja perusmaksut voimassaoloaikoineen, joten hinnanmuutoksen voi kirjata etukäteen.",
          "Kiinteistölle voi lisätä omia kuukausi- tai kertamaksuja.",
          "Lainaosuudet laskutetaan kuukausierinä korkoineen, ja loppuerä on laskulla omana rivinään.",
        ],
      },
    ],
    related: ["laskukanava", "omistajanvaihdos", "lukemat"],
  },
  {
    slug: "laskukanava",
    group: "Laskutus",
    icon: "split",
    title: "Fennoa-vienti ja laskukanava",
    summary: "Lasku lähtee sitä kanavaa pitkin, joka asiakkaalle on luvattu. Kanava tarkistetaan ennen vientiä ja sen jälkeen.",
    highlights: [
      "Laskukanava pakollinen ennen vientiä",
      "Viety lasku luetaan takaisin ja verrataan lähetettyyn",
      "Poikkeamat ja estetyt laskut näkyvät syineen",
    ],
    appPath: "/laskutus",
    appLabel: "Laskutus",
    sections: [
      {
        title: "Miksi kanava on pakollinen",
        text: "Moni järjestelmä kertoo asiakkaalle laskun tulevan sähköpostiin, mutta lähettää sen postissa. Mittarilukema ei vie laskua ilman asiakkaalle valittua kanavaa, ja kanavan tiedot tarkistetaan: sähköpostilaskulla pitää olla yksi kelvollinen osoite, verkkolaskulla osoite ja operaattori, paperilaskulla postiosoite.",
      },
      {
        title: "Vienti",
        steps: [
          "Avaa hyväksytty laskutusajo ja valitse Vie Fennoaan.",
          "Laskut viedään erissä. Jos laskuja jää jäljelle, jatka vientiä.",
          "Tarkista estetyt laskut. Syy näkyy laskulla, esimerkiksi puuttuva laskukanava.",
          "Korjaa asiakkaan tiedot ja vie uudelleen.",
        ],
      },
      {
        title: "Tilat",
        bullets: [
          "Viety: Fennoa hyväksyi laskun, ja kanava vastaa lähetettyä.",
          "Estetty: laskua ei viety, koska kanava tai sen tiedot puuttuvat.",
          "Poikkeama: Fennoan tallentama kanava tai osoite eroaa lähetetystä.",
          "Epäonnistui: Fennoa hylkäsi laskun, ja syy näkyy viestissä.",
        ],
      },
    ],
    tips: ["Viennit näkyvät myös asiakkaan lähetyslokissa kanavineen."],
    related: ["laskutus", "lahetysloki"],
  },
  {
    slug: "tiedotteet",
    group: "Viestintä",
    icon: "megaphone",
    title: "Tiedotteet sähköpostilla ja kirjeenä",
    summary: "Katkostiedote tai hinnanmuutos kaikille asiakkaille tai yhdelle alueelle: sähköposti ensin, kirje niille, joilla sitä ei ole.",
    highlights: [
      "Kirjoitettu tiedote tai valmis PDF",
      "Ikkunakirjeet PDF:nä tulostettavaksi tai Postitan kautta",
      "Vastaanottajat lukitaan ennen lähetystä",
    ],
    appPath: "/tiedotteet",
    appLabel: "Tiedotteet",
    sections: [
      {
        title: "Tiedotteen lähettäminen",
        steps: [
          "Avaa Tiedotteet ja valitse Uusi tiedote.",
          "Kirjoita otsikko ja teksti, tai liitä valmis PDF tallennuksen jälkeen.",
          "Valitse vastaanottajat (maksajat tai kaikki sopimusten osapuolet), alue ja toimitustapa.",
          "Lähetä itsellesi koeviesti.",
          "Lukitse vastaanottajat. Lista ei enää muutu, vaikka rekisteri muuttuisi.",
          "Lähetä sähköpostit ja käsittele kirjeet.",
        ],
      },
      {
        title: "Kirjeet",
        bullets: [
          "Kirjeet tehdään yhtenä PDF:nä ikkunakuoren mittoihin. Saatesivulla on osoite, ja PDF-tiedotteen sivut tulevat sen perään.",
          "Kirjeet voi tulostaa itse ja merkitä tulostetuiksi.",
          "Postitan kautta kirjeet ladataan ensin vahvistamattomina, ja lähetys vahvistetaan tai perutaan erikseen. Kirjeessä voi olla enintään 12 sivua.",
        ],
      },
    ],
    related: ["lahetysloki"],
  },
  {
    slug: "lahetysloki",
    group: "Viestintä",
    icon: "list",
    title: "Asiakkaan lähetysloki",
    summary: "Asiakkaan sivulta näkee, mitä hänelle on lähetetty, milloin ja mitä kanavaa pitkin.",
    highlights: ["Tiedotteet ja laskut samassa lokissa", "Osoite lähetyshetken mukaan", "Tila: lähetetty, tulostettu, estetty"],
    appPath: "/asiakkaat",
    appLabel: "Asiakkaat",
    sections: [
      {
        title: "Mitä lokissa on",
        bullets: [
          "Tiedotteet: kanava (sähköposti tai kirje), osoite, johon viesti lähti, ja tila.",
          "Laskut: jakso, summa, laskukanava ja Fennoa-viennin tila.",
          "Osoite on se, johon viesti todella lähti, vaikka asiakkaan tiedot olisivat myöhemmin muuttuneet.",
        ],
      },
    ],
    related: ["tiedotteet", "laskukanava"],
  },
  {
    slug: "kayttajat",
    group: "Hallinta ja tietoturva",
    icon: "shield",
    title: "Käyttäjät, roolit ja tietoturva",
    summary: "Jokainen laitos näkee vain omat tietonsa, ja jokainen muutos jää lokiin.",
    highlights: [
      "Roolit: pääkäyttäjä, toimisto ja mittarinlukija",
      "Organisaatioiden eristys tietokantatasolla",
      "Kirjautuminen kaksivaiheisella tunnistuksella",
    ],
    appPath: "/asetukset",
    appLabel: "Asetukset",
    sections: [
      {
        title: "Roolit",
        bullets: [
          "Pääkäyttäjä: kaikki toiminnot ja organisaation asetukset.",
          "Toimisto: rekisteri, lukemat, laskutus ja tiedotteet.",
          "Mittarinlukija: lukulistat ja lukemien kirjaus.",
        ],
      },
      {
        title: "Tietoturva",
        bullets: [
          "Jokainen tietokantakysely rajataan käyttäjän organisaatioon tietokannan riviturvalla, ei pelkästään sovelluksen koodissa.",
          "Muutokset kirjataan lokiin samassa tapahtumassa kuin itse muutos.",
          "Henkilötunnuksia ei käsitellä. Henkilötietoja ei kirjoiteta osoitteisiin, lokeihin eikä virheviesteihin.",
          "Tietokanta sijaitsee EU:ssa.",
        ],
      },
    ],
  },
  {
    slug: "muutosilmoitus",
    group: "Viestintä",
    icon: "pen",
    title: "Asiakkaan muutosilmoitus",
    summary: "Asiakas ilmoittaa kaupasta, muutosta tai uusista laskutustiedoista itse lomakkeella tai QR-koodilla, ja toimisto kirjaa sen parilla painalluksella.",
    highlights: [
      "QR-koodi laskuun tai tiedotteeseen",
      "Lukema ja lainan kohtalo samalla ilmoituksella",
      "Vaihdoslomake täyttyy ilmoituksen tiedoilla",
    ],
    appPath: "/muutosilmoitukset",
    appLabel: "Muutosilmoitukset",
    sections: [
      {
        title: "Lomake asiakkaille",
        bullets: [
          "Lomakkeen osoite ja QR-koodi ovat Muutosilmoitukset-sivulla. QR-koodin voi ladata PNG-kuvana laskupohjaan tai SVG-kuvana painettavaan tiedotteeseen.",
          "Asiakas valitsee ilmoituksen: kiinteistö on myyty, vuokralainen muuttaa sisään tai pois, laskutustiedot muuttuvat tai muu asia. Lomake kysyy vain kyseiseen ilmoitukseen tarvittavat tiedot.",
          "Kaupassa kysytään ostaja, luovutuspäivä, lukema ja se, siirtyykö liittymän laina kauppakirjan mukaan ostajalle.",
          "Lomake ei näytä rekisteristä mitään, joten sen voi jakaa vapaasti.",
        ],
      },
      {
        title: "Ilmoituksen käsittely",
        steps: [
          "Uudet ilmoitukset näkyvät työpöydällä ja Muutosilmoitukset-sivulla. Toimiston sähköpostiin tulee ilmoitus, jos yhteystiedoissa on sähköpostiosoite.",
          "Avaa ilmoitus ja kohdista se käyttöpaikkaan. Osoitteen perusteella tehty ehdotus on listan alussa.",
          "Valitse Kirjaa omistajanvaihdos tai Kirjaa vuokralaisen vaihdos. Lomake on valmiiksi täytetty: vaihtopäivä, uusi asiakas, lukema ja lainan kohtalo.",
          "Tarkista tiedot ja kirjaa. Ilmoitus merkitään samalla käsitellyksi ja liitetään käyttöpaikan tapahtumaan.",
          "Laskutustietojen muutoksessa päivitä asiakkaan tiedot ja merkitse ilmoitus käsitellyksi. Hylkäyksessä kirjoitetaan syy.",
        ],
      },
      {
        title: "Tietosuoja ja väärinkäytön esto",
        bullets: [
          "Lomake ei hyväksy henkilötunnusta.",
          "Samasta osoitteesta voi lähettää enintään viisi ilmoitusta tunnissa. Robotit pysäytetään ansakentällä.",
          "Ilmoitukset näkevät vain pääkäyttäjä ja toimisto, eivät mittarinlukijat.",
          "Jos lomake joutuu roskapostin kohteeksi, pääkäyttäjä voi vaihtaa sen osoitteen. Vanha osoite ja QR-koodi lakkaavat silloin toimimasta.",
        ],
      },
    ],
    related: ["omistajanvaihdos", "aikajana"],
  },
];

export function helpTopic(slug: string) {
  return HELP_TOPICS.find((t) => t.slug === slug) ?? null;
}
