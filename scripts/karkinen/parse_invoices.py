"""Kärkisen vanhan järjestelmän laskut (PDF, yksi lasku sivulla) JSON-muotoon.

    python scripts/karkinen/parse_invoices.py <lasku.pdf> [...] [--kansio data/private/karkinen/laskut]

Jokaisesta PDF:stä kirjoitetaan <kansio>/<tiedoston nimi>.json: sivuittain
kohteen osoiterivi, viitenumero, laskupäivä, eräpäivä, laskurivit (maksulaji,
selite, jakso, määrä, à-hinta, summa ja rivin alla olevat mittarilukemat
"893,0 m3 - 913,0 m3") sekä loppusumma. Sarakkeet tunnistetaan sanojen
x-sijainnista, joten asettelun muutos näkyy jäsentämättöminä riveinä.

Tulostaa vain määriä. Tulos sisältää henkilötietoja, joten se kirjoitetaan
data/private-kansioon, joka ei ole versionhallinnassa.
"""

import collections
import json
import os
import re
import sys

import pymupdf


def num(s):
    return float(s.replace(" ", "").replace(" ", "").replace(",", "."))


def fi_date(s):
    m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", s)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def parse_page(page, stats):
    rows = collections.defaultdict(list)
    for w in page.get_text("words"):
        rows[round(w[1] / 2)].append(w)
    text = page.get_text()
    ref = re.search(r"86210\s*70000\s*(\d{5})", text)
    inv = {"osoiterivi": None, "vastaanottaja": None, "viite": ref.group(1) if ref else None, "paiva": None, "erapaiva": None, "rivit": [], "yhteensa": None}
    # Vastaanottajan nimi osoitekentän ensimmäiseltä riviltä (y≈95–120; ylempänä on lähettäjä),
    # jolla ratkaistaan saman tai lähes saman osoitteen kiinteistöt.
    cand = [w for w in page.get_text("words") if 95 < w[1] < 120 and w[0] < 330]
    if cand:
        first_y = min(w[1] for w in cand)
        inv["vastaanottaja"] = " ".join(w[4] for w in sorted((w for w in cand if abs(w[1] - first_y) < 3), key=lambda w: w[0]))
    for key in sorted(rows):
        ws = sorted(rows[key], key=lambda w: w[0])
        words = [w[4] for w in ws]
        joined = " ".join(words)
        # Laskupäivä oikeassa yläkulmassa (x≈408), kohteen rivi eräpäivän kanssa (x≈322).
        if inv["paiva"] is None and any(abs(w[0] - 408) < 6 and fi_date(w[4]) for w in ws) and ws[0][1] < 100:
            inv["paiva"] = fi_date(next(w[4] for w in ws if abs(w[0] - 408) < 6))
        if inv["osoiterivi"] is None and 230 < ws[0][1] < 400 and any(abs(w[0] - 322) < 8 and fi_date(w[4]) for w in ws):
            inv["osoiterivi"] = " ".join(w[4] for w in ws if w[0] < 285)
            inv["erapaiva"] = fi_date(next(w[4] for w in ws if abs(w[0] - 322) < 8))
            continue
        # Laskurivi: kolminumeroinen maksulaji vasemmassa reunassa.
        if ws and ws[0][0] < 45 and re.fullmatch(r"\d{3}", ws[0][4]):
            dates = [fi_date(w[4]) for w in ws if fi_date(w[4])]
            qty = [w for w in ws if 320 < w[0] < 372 and re.fullmatch(r"-?[\d,]+", w[4])]
            price = [w for w in ws if 400 < w[0] < 460 and re.fullmatch(r"-?[\d,]+", w[4])]
            total = [w for w in ws if w[0] > 500 and re.fullmatch(r"-?[\d ,]+", w[4])]
            vat = [w for w in ws if 280 < w[0] < 310 and re.fullmatch(r"[\d,]+", w[4])]
            inv["rivit"].append({
                "koodi": ws[0][4], "laji": " ".join(w[4] for w in ws if 45 < w[0] < 180),
                "alku": dates[0] if dates else None, "loppu": dates[-1] if len(dates) > 1 else None,
                "alv": num(vat[0][4]) if vat else None,
                "maara": num(qty[0][4]) if qty else None, "yks": "m3" if "m3" in words else None,
                "hinta": num(price[0][4]) if price else None,
                "summa": num("".join(w[4] for w in total)) if total else None, "lukemat": [],
            })
            continue
        # Lukemarivi edellisen laskurivin alla.
        m = re.fullmatch(r"([\d ]+,\d+) m3 - ([\d ]+,\d+) m3", " ".join(w[4] for w in ws if w[0] < 200))
        if m and inv["rivit"]:
            inv["rivit"][-1]["lukemat"].append([num(m.group(1)), num(m.group(2))])
            continue
        if "yhteensä" in words and any(w[0] > 500 for w in ws) and inv["yhteensa"] is None:
            inv["yhteensa"] = num("".join(w[4] for w in ws if w[0] > 500))
    if not inv["rivit"]:
        stats["sivu ilman laskurivejä"] += 1
    return inv


def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--") and not (sys.argv.index(a) > 1 and sys.argv[sys.argv.index(a) - 1] == "--kansio")]
    if not files:
        sys.exit(__doc__)
    out_dir = sys.argv[sys.argv.index("--kansio") + 1] if "--kansio" in sys.argv else "data/private/karkinen/laskut"
    os.makedirs(out_dir, exist_ok=True)
    for path in files:
        stats = collections.Counter()
        pages = [parse_page(p, stats) for p in pymupdf.open(path)]
        pages = [p for p in pages if p["rivit"]]
        # Sivun summa tarkistetaan riveistä.
        bad = sum(1 for p in pages if p["yhteensa"] is not None and abs(sum(r["summa"] or 0 for r in p["rivit"]) - p["yhteensa"]) > 0.005)
        out = os.path.join(out_dir, os.path.splitext(os.path.basename(path))[0] + ".json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"tiedosto": os.path.basename(path), "laskut": pages}, f, ensure_ascii=False, indent=1)
        codes = collections.Counter(r["koodi"] for p in pages for r in p["rivit"])
        readings = sum(len(r["lukemat"]) for p in pages for r in p["rivit"])
        print(f"{os.path.basename(path)}: laskuja {len(pages)}, rivejä {sum(codes.values())}, lukemapareja {readings}, "
              f"summa ei täsmää {bad}, ilman osoiteriviä {sum(1 for p in pages if not p['osoiterivi'])}, "
              f"yhteensä {round(sum(p['yhteensa'] or 0 for p in pages), 2)} €. Maksulajit {dict(sorted(codes.items()))}."
              + (f" {dict(stats)}" if stats else ""))


if __name__ == "__main__":
    main()
