"""
Fennoan kirjanpitoviennin myyntilaskut (IN-tositteet) JSON-muotoon.

    python scripts/fennoa/parse_invoices.py <fennoa_export.zip> [data/private/fennoa/invoices.json]

Lukee PDF:t suoraan zip-paketista (vaatii PyMuPDF:n). Poimii laskulta
otsaketiedot, laskutusosoitteen, tuoterivit ja mittarilukemat. Lukemarivit on
kirjoitettu laskuille vapaalla tekstillä, joten jäsennin tunnistaa useita
muotoja ja täsmäyttää lukemien erotuksen laskutettuun kulutukseen.

Tulos sisältää asiakastietoja: se kirjoitetaan data/private-kansioon, joka ei
ole versionhallinnassa. Tuloste näyttää vain määriä.
"""
import collections
import json
import os
import re
import sys
import zipfile

import pymupdf

DATE = r'(\d{1,2}\.\d{1,2}\.\d{4})'
NUM = r'(\d[\d ]*(?:,\d+)?)'
USAGE = re.compile(r'(?:Unes|Käyttöpaikka):\s*(\d+)\s*(?:/\s*(.+))?')


def num(s):
    return float(s.replace(' ', '').replace(',', '.')) if s not in (None, '') else None


def iso(s):
    if not s:
        return None
    dd, mm, yy = s.split('.')
    return f'{yy}-{int(mm):02d}-{int(dd):02d}'


def page_lines(page):
    """Sanat riveiksi y-koordinaatin mukaan: [(x, sana), ...] vasemmalta oikealle."""
    rows = collections.defaultdict(list)
    for w in page.get_text('words'):
        rows[round(w[1] / 3)].append(w)
    return [[(round(w[0]), w[4]) for w in sorted(rows[k], key=lambda w: w[0])] for k in sorted(rows)]


def header(text):
    def g(p):
        m = re.search(p, text)
        return m.group(1) if m else None
    return {
        'laskunro': g(r'Laskunumero\s*\n?\s*(\d+)'),
        'asiakasnro': g(r'Asiakas nro\s*\n?\s*(\d+)'),
        'laskupvm': iso(g(r'Laskupäivä\s*\n?\s*' + DATE)),
        'toimituspvm': iso(g(r'Toimituspäivä\s*\n?\s*' + DATE)),
        'tyyppi': 'Hyvityslasku' if re.search(r'^Hyvityslasku\s*$', text, re.M) else 'Lasku',
    }


def billing(lines):
    """Laskutusosoite: nimirivit, katuosoite, postinumero ja toimipaikka vasemmasta palstasta."""
    for i, l in enumerate(lines):
        if l and l[0][1] == 'Laskutusosoite':
            block = []
            for nxt in lines[i + 1:i + 8]:
                left = ' '.join(w for x, w in nxt if x < 200)
                if left:
                    block.append(left)
            for j, b in enumerate(block):
                m = re.match(r'^(\d{5})\s+(.+)$', b)
                if m and j >= 1:
                    return {'nimi': ' '.join(block[:j - 1]) or block[0] if j >= 2 else block[0],
                            'katu': block[j - 1] if j >= 2 else None, 'postinro': m.group(1), 'toimipaikka': m.group(2)}
            return {'nimi': block[0] if block else None, 'katu': None, 'postinro': None, 'toimipaikka': None}
    return {'nimi': None, 'katu': None, 'postinro': None, 'toimipaikka': None}


def rows(pages):
    """Tuoterivit sarakkeiden x-sijainnin perusteella (sarakkeet ovat kaikissa laskuissa samoissa kohdissa)."""
    out = []
    for lines in pages:
        inside = False
        for l in lines:
            words = [w for _, w in l]
            if words[:3] == ['Tuote', '/', 'Selite']:
                inside = True
                continue
            if not inside:
                continue
            if words and words[0] == 'Yhteensä':
                inside = False
                continue
            cols = collections.defaultdict(list)
            for x, w in l:
                c = ('name' if x < 260 else 'qty' if x < 305 else 'unit' if x < 350 else 'price' if x < 405
                     else 'vat' if x < 455 else 'net' if x < 515 else 'gross')
                cols[c].append(w)
            if not cols.get('vat') or not re.fullmatch(r'\d+(,\d+)?', ''.join(cols['vat'])):
                continue
            j = lambda k: ''.join(cols.get(k, [])) or None
            out.append({'tuote': ' '.join(cols.get('name', [])), 'lkm': num(j('qty')), 'yks': ' '.join(cols.get('unit', [])) or None,
                        'hinta': num(j('price')), 'alv': num(j('vat')), 'veroton': num(j('net')), 'yhteensa': num(j('gross'))})
    return out


PATTERNS = [
    # Edellinen lukema 5657 m3, 30.9.2025 - 31.3.2026: 5710 m3, Unes: 71030 / OSOITE
    ('A', re.compile(r'Edellinen lukema\s*' + NUM + r'\s*(?:m3)?,\s*' + DATE + r'\s*-\s*' + DATE + r':\s*' + NUM + r'\s*m3')),
    # Edellinen lukema 2318,000 - Uusi lukema 2368,000, Unes: ...
    ('B', re.compile(r'Edellinen lukema\s*' + NUM + r'\s*-\s*Uusi lukema\s*' + NUM)),
    # Mittarin lukemat 29710-29874. Mittarin kerroin 50.
    ('D', re.compile(r'Mittarin lukemat\s*' + NUM + r'\s*-\s*' + NUM + r'\.\s*Mittarin kerroin\s*(\d+)')),
    # Lukema 100 - 150 m3, 30.9.2025 - 31.3.2026: ... | Lukemat: 27-27 | laskutusjakso ...: lukema 14-68
    ('C', re.compile(r'(?i)(?:Edellinen lukema|lukemat?):?\s*' + NUM + r'\s*-\s*' + NUM + r'(?:\s*m3)?(?:,\s*' + DATE + r'\s*-\s*' + DATE + r')?')),
]


def readings(text):
    out = []
    lines = text.splitlines()
    for i, raw in enumerate(lines):
        l2 = raw.replace(' ', ' ')
        unes = USAGE.search(l2)
        rec = None
        for name, p in PATTERNS:
            m = p.search(l2)
            if not m:
                continue
            g = m.groups()
            if name == 'A':
                rec = dict(muoto=name, edellinen=num(g[0]), jakso_alku=iso(g[1]), jakso_loppu=iso(g[2]), uusi=num(g[3]))
            elif name == 'B':
                rec = dict(muoto=name, edellinen=num(g[0]), uusi=num(g[1]))
            elif name == 'D':
                rec = dict(muoto=name, edellinen=num(g[0]), uusi=num(g[1]), kerroin=int(g[2]))
            else:
                rec = dict(muoto=name, edellinen=num(g[0]), uusi=num(g[1]), jakso_alku=iso(g[2]), jakso_loppu=iso(g[3]))
            break
        m2 = re.match(r'Mittarilukema\s+' + DATE + r':\s*' + NUM, l2)
        if rec is None and m2:
            # Käyttöpaikka / Laskutuskausi / Edellinen lukema pvm: x / Mittarilukema pvm: y
            prev = re.match(r'Edellinen lukema\s+' + DATE + r':\s*' + NUM, lines[i - 1]) if i else None
            rec = dict(muoto='E', uusi=num(m2.group(2)), jakso_loppu=iso(m2.group(1)),
                       edellinen=num(prev.group(2)) if prev else None, jakso_alku=iso(prev.group(1)) if prev else None)
            for back in lines[max(0, i - 4):i]:
                u = re.search(r'Käyttöpaikka:\s*(\d+)\s*(?:/\s*(.+))?', back)
                if u:
                    unes = u
            nxt = lines[i + 1] if i + 1 < len(lines) else ''
            if 'ei ole vesimittaria' in nxt:
                rec['muoto'] = 'F'
                agreed = re.search(r'kulutukseen,\s*' + NUM + r'\s*m3', nxt)
                rec['sovittu_m3'] = num(agreed.group(1)) if agreed else None
        if rec is None:
            continue
        if unes is None:
            for nb in lines[i + 1:i + 3]:
                u = USAGE.search(nb)
                if u:
                    unes = u
                    break
        rec['unes'] = unes.group(1) if unes else None
        rec['kayttopaikka'] = unes.group(2).strip() if unes and unes.group(2) else None
        rec['rivi'] = l2.strip()
        out.append(rec)
    return out


USE_W = re.compile(r'^(Vesi|Kylmävesi|Veden kulutus)', re.I)
USE_WW = re.compile(r'^(Jätevesi|Jäteveden kulutus)', re.I)


def reconcile(inv):
    """Täsmäytys: lukemien erotus × kerroin = laskutettu kulutus."""
    if not inv['lukemat']:
        return 'ei lukemaa'
    rs = [r for r in inv['lukemat'] if r['muoto'] != 'F']
    if not rs:
        return 'ei mittaria (sovittu kulutus)'
    if any(r['edellinen'] is None or r['uusi'] is None for r in rs):
        return 'lukema puutteellinen'
    for r in rs:
        r['kulutus'] = round((r['uusi'] - r['edellinen']) * (r.get('kerroin') or 1), 3)
    usage = lambda rx: [r['lkm'] for r in inv['rivit'] if rx.match(r['tuote']) and 'perusmaksu' not in r['tuote'].lower() and r['lkm'] is not None]
    u = usage(USE_W) or usage(USE_WW)
    cons = sum(r['kulutus'] for r in rs)
    if not u:
        return 'ei kulutusriviä'
    if abs(sum(u) - cons) < 0.01 or any(abs(x - cons) < 0.01 for x in u):
        return 'täsmää'
    return f'ei täsmää: lukemista {round(cons, 3)} m3, laskulla {"+".join(str(x) for x in u)} m3'


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join('data', 'private', 'fennoa', 'invoices.json')
    invoices = []
    with zipfile.ZipFile(sys.argv[1]) as z:
        names = [n for n in z.namelist() if re.fullmatch(r'IN-\d+\.pdf', os.path.basename(n))]
        names.sort(key=lambda n: int(re.findall(r'\d+', os.path.basename(n))[0]))
        for n in names:
            doc = pymupdf.open(stream=z.read(n), filetype='pdf')
            pages = [page_lines(p) for p in doc]
            text = '\n'.join(p.get_text() for p in doc)
            inv = header(text)
            inv['tiedosto'] = os.path.basename(n)
            inv['laskutus'] = billing(pages[0])
            inv['rivit'] = rows(pages)
            inv['lukemat'] = readings(text)
            inv['tarkistus'] = reconcile(inv)
            invoices.append(inv)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(invoices, f, ensure_ascii=False, indent=1)
    status = collections.Counter(i['tarkistus'].split(':')[0] for i in invoices)
    print(f'Laskuja {len(invoices)}, lukemia {sum(len(i["lukemat"]) for i in invoices)}, rivejä {sum(len(i["rivit"]) for i in invoices)}.')
    print('Täsmäytys: ' + ', '.join(f'{k} {v}' for k, v in status.most_common()))
    print(f'Tallennettu: {out_path}')


if __name__ == '__main__':
    main()
