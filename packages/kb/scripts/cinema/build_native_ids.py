#!/usr/bin/env python3
"""Ids of IMDb titles that look like Brazilian originals, plus the episodes of such series. IMDb's open datasets carry no country of
origin, so this is a heuristic: the ORIGINAL title (akas row with isOriginalTitle=1) is written in Portuguese (a Portuguese-only letter or word)
and the title has a release row for region BR. It also admits Portuguese (Portugal) originals released in Brazil; both speak Portuguese.
One numeric id per line. usage: build_native_ids.py IMDB_DIR OUT
"""
import csv, gzip, re, sys, os
d, out = sys.argv[1], sys.argv[2]
PT = re.compile(r"[ãõ]|\b(?:não|você|vocês|nós|às|aos|meu|minha|meus|minhas|uma|umas|ainda|também|porque|quando|sempre|nunca|todo|toda|muito|pra|pro|dona|seu|sua|nosso|nossa)\b", re.I)
orig, br = {}, set()
with gzip.open(os.path.join(d, "title.akas.tsv.gz"), "rt", encoding="utf8", newline="") as f:
    r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
    next(r)
    for row in r:
        tid, title, region, lang, isorig = row[0], row[2], row[3], row[4], row[7]
        if isorig == "1":
            orig[tid] = title
        if region == "BR":
            br.add(tid)
native = {t for t, title in orig.items() if t in br and PT.search(title)}
print("titles", len(native), flush=True)
extra = set()
with gzip.open(os.path.join(d, "title.episode.tsv.gz"), "rt", encoding="utf8", newline="") as f:
    r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
    next(r)
    for row in r:
        if row[1] in native:
            extra.add(row[0])
print("episodes", len(extra), flush=True)
native |= extra
with open(out, "w") as o:
    for t in sorted(native):
        o.write(t[2:].lstrip("0") + "\n")
import random
random.seed(1)
print([orig.get(t, "(episode)") for t in random.sample(sorted(native - extra), 25)])
