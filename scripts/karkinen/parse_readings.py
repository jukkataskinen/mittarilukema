"""Kärkisen mittarilukemataulukko (Excel) JSON-muotoon.

    python scripts/karkinen/parse_readings.py "<kansio>/VOK mittarilukemat ... .xlsx" [--ulos data/private/karkinen/lukemat.json]

Sarakkeet: PVM (edellinen lukupäivä), EDELLINEN LUKEMA, UUSI LUKUPVM, UUSI LUKEMA,
nimi, KIINTEISTÖ (osoite). Tulos sisältää henkilötietoja, joten se kirjoitetaan
data/private-kansioon. Tulostaa vain määriä.
"""

import datetime
import json
import os
import sys

import openpyxl


def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not files:
        sys.exit(__doc__)
    out = sys.argv[sys.argv.index("--ulos") + 1] if "--ulos" in sys.argv else "data/private/karkinen/lukemat.json"
    ws = openpyxl.load_workbook(files[0], data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    # Otsikkorivi ei välttämättä ole ensimmäinen rivi.
    start = next((i for i, r in enumerate(rows[:10]) if [str(h or "").strip() for h in r[:4]] == ["PVM", "EDELLINEN LUKEMA", "UUSI LUKUPVM", "UUSI LUKEMA"]), None)
    if start is None or str(rows[start][5] or "").strip() != "KIINTEISTÖ":
        sys.exit("Lukemataulukon sarakkeet ovat muuttuneet.")
    rows = rows[start:]
    iso = lambda v: v.date().isoformat() if isinstance(v, datetime.datetime) else None
    num = lambda v: float(v) if isinstance(v, (int, float)) else None
    result = []
    for r in rows[1:]:
        if not r[5]:
            continue
        result.append({
            "osoite": str(r[5]).strip(), "nimi": str(r[4]).strip() if r[4] else None,
            "edellinen_pvm": iso(r[0]), "edellinen": num(r[1]), "uusi_pvm": iso(r[2]), "uusi": num(r[3]),
        })
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"tiedosto": os.path.basename(files[0]), "lukemat": result}, f, ensure_ascii=False, indent=1)
    both = sum(1 for x in result if x["edellinen"] is not None and x["uusi"] is not None)
    print(f"Rivejä {len(result)}: edellinen ja uusi lukema {both}, vain edellinen {sum(1 for x in result if x['edellinen'] is not None and x['uusi'] is None)}.")
    print(f"Kirjoitettu {out}")


if __name__ == "__main__":
    main()
