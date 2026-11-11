#!/usr/bin/env python3
"""Sample subtitle files from the OPUS OpenSubtitles v2018 raw zip using HTTP range reads
(no full 8-13 GB download). Subtitles are for LOCAL analysis only; output dir is gitignored.
usage: fetch_opus_sample.py LANG(pt_br|en) N OUTDIR [seed] [ids_file]
  ids_file: only files whose IMDb id (numeric, one per line) is listed are sampled
"""
import io, os, random, struct, sys, time, urllib.request, zipfile

LANG, N, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3]
SEED = int(sys.argv[4]) if len(sys.argv) > 4 else 7
IDS = set(open(sys.argv[5]).read().split()) if len(sys.argv) > 5 else None
URL = f"https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/raw/{LANG}.zip"
UA = "perfectman-kb-research/1.0 (local analysis; range reads)"

class HttpRange(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos = url, 0
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        self.size = int(urllib.request.urlopen(req).headers["Content-Length"])
        self.cache = {}
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def readinto(self, b):
        n = len(b)
        if n == 0 or self.pos >= self.size: return 0
        end = min(self.pos + n, self.size) - 1
        req = urllib.request.Request(self.url, headers={"User-Agent": UA, "Range": f"bytes={self.pos}-{end}"})
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(req, timeout=60).read(); break
            except Exception as e:
                time.sleep(2 * (attempt + 1))
        else:
            raise
        b[:len(data)] = data; self.pos += len(data); return len(data)

f = io.BufferedReader(HttpRange(URL), buffer_size=1 << 20)
z = zipfile.ZipFile(f)
names = [i for i in z.infolist() if i.filename.endswith(".xml") or i.filename.endswith(".xml.gz")]
print("entries", len(names), flush=True)
if IDS is not None:
    names = [i for i in names if len(i.filename.split("/")) >= 4 and i.filename.split("/")[-2] in IDS]
    print("allow-listed entries", len(names), flush=True)
random.seed(SEED); random.shuffle(names)
os.makedirs(OUT, exist_ok=True)
got = 0
for info in names:
    if got >= N: break
    if info.file_size < 20000: continue  # skip tiny/empty
    rel = info.filename.split("/", 2)[-1] if "/" in info.filename else info.filename
    dest = os.path.join(OUT, rel.replace("/", "__"))
    if os.path.exists(dest): got += 1; continue
    try:
        data = z.read(info)
    except Exception as e:
        print("skip", info.filename, e); continue
    open(dest, "wb").write(data); got += 1
    if got % 25 == 0: print(got, flush=True)
    time.sleep(0.15)
print("done", got)
