#!/usr/bin/env python3
"""Draws the human-likeness preview (cinematic revamp B5): per arm a contact sheet of top-down snapshots of the Terraco with each actor's
position, facing, typing bubble, face and gesture, and a lane chart of the whole scene (typing, lines, gestures and faces, walks).

    python3 -I render-humanlike.py <dir with arm-h*.json> [--window START END] [--step SECONDS] [--gif]

Reads what `node dist/humanlike/preview.js <dir>` wrote. Needs Pillow."""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 22  # pixels per tile
COLORS = {"heloisa": (214, 88, 140), "otavio": (64, 120, 214), "renato": (60, 160, 90)}
FILL = {"sit": (214, 186, 140), "lay": (214, 186, 140), "table": (150, 110, 80), "bar": (130, 130, 140), "plant": (92, 160, 92), "rug": (200, 170, 190), "decor": (70, 70, 80), "window": (150, 200, 230)}
FACE = {"smile": ":)", "angry": ">:(", "sad": ":(", "surprised": ":O", "sleepy": "-_-", "neutral": "", "fear": "D:", "disgust": "ugh", "smug": ":>"}


def font(size):
    for name in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


F10, F12, F14, F18 = font(10), font(12), font(14), font(20)


def state_at(trace, t):
    """Placement, face, typing and gesture of everybody at time t (ms)."""
    pos, face, typing, gest = {}, {}, {}, {}
    for e in trace["events"]:
        if e["t"] > t:
            break
        k = e["kind"]
        if k == "pos":
            pos[e["ref"]] = e
        elif k == "expression":
            face[e["ref"]] = e
        elif k == "typing":
            typing[e["ref"]] = e["on"]
        elif k == "gesture":
            gest[e["ref"]] = e
        elif k == "chat":
            typing[e["ref"]] = False
    return pos, face, typing, gest


def draw_room(d, ox, oy, layout, trace, t, names):
    w, h = layout["w"], layout["h"]
    d.rectangle([ox, oy, ox + w * S, oy + h * S], fill=(238, 232, 222), outline=(120, 110, 100))
    for x in range(w):
        for y in range(h):
            if (x + y) % 2 == 0:
                d.rectangle([ox + x * S, oy + y * S, ox + (x + 1) * S - 1, oy + (y + 1) * S - 1], fill=(231, 224, 213))
    for f in layout["furni"]:
        kinds = f["kinds"]
        kind = next((k for k in ("table", "bar", "plant", "rug", "window", "sit", "lay") if k in kinds), "decor")
        for (x, y) in f["tiles"]:
            d.rectangle([ox + x * S + 1, oy + y * S + 1, ox + (x + 1) * S - 2, oy + (y + 1) * S - 2], fill=FILL.get(kind, (90, 90, 90)))
    pos, face, typing, gest = state_at(trace, t)
    # trails: the last 20 s of each walker
    for ref, color in COLORS.items():
        pts = [(e["tile"], e["t"]) for e in trace["events"] if e["kind"] == "pos" and e["ref"] == ref and t - 20000 <= e["t"] <= t]
        if len(pts) >= 2:
            line = [(ox + (p[0][0] + 0.5) * S, oy + (p[0][1] + 0.5) * S) for p in pts]
            d.line(line, fill=color + (0,) if False else color, width=2)
    # who spoke in the last 2.5 s
    speaking = {e["ref"]: e for e in trace["events"] if e["kind"] == "chat" and t - 2500 <= e["t"] <= t}
    for ref, p in pos.items():
        color = COLORS.get(ref, (120, 120, 120))
        cx, cy = ox + (p["tile"][0] + 0.5) * S, oy + (p["tile"][1] + 0.5) * S
        r = 8
        if p["state"] == "sit":
            d.rounded_rectangle([cx - r, cy - r, cx + r, cy + r], radius=3, fill=color, outline=(30, 30, 30))
        else:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color, outline=(30, 30, 30))
        a = math.radians(p["dir"] * 45)
        d.line([cx, cy, cx + math.sin(a) * 15, cy - math.cos(a) * 15], fill=(20, 20, 20), width=3)
        d.ellipse([cx + math.sin(a) * 15 - 2, cy - math.cos(a) * 15 - 2, cx + math.sin(a) * 15 + 2, cy - math.cos(a) * 15 + 2], fill=(20, 20, 20))
        d.text((cx - 4, cy - 7), names.get(ref, ref)[0], fill=(255, 255, 255), font=F12)
        if typing.get(ref):
            d.rounded_rectangle([cx - 11, cy - 27, cx + 11, cy - 16], radius=4, fill=(255, 235, 120), outline=(120, 100, 20))
            d.text((cx - 8, cy - 28), "...", fill=(60, 50, 10), font=F12)
        elif ref in speaking:
            d.rounded_rectangle([cx - 11, cy - 27, cx + 11, cy - 16], radius=4, fill=(255, 255, 255), outline=color, width=2)
            d.text((cx - 5, cy - 28), "“", fill=color, font=F12)
        fe = face.get(ref)
        if fe and t - fe["t"] < 9000 and FACE.get(fe["face"]):
            d.text((cx + 10, cy - 20), FACE[fe["face"]], fill=(160, 20, 20), font=F12)
        ge = gest.get(ref)
        if ge and t - ge["t"] < 2500:
            d.text((cx + 8, cy + 8), ge["a"] + (str(ge.get("style", "")) if ge["a"] == "sign" else ""), fill=(30, 30, 140), font=F10)


def lane_chart(trace, width, duration, names, bodylog=None):
    refs = list(COLORS)
    lane_h = 46
    img = Image.new("RGB", (width, 24 + lane_h * len(refs) + 18), (250, 248, 244))
    d = ImageDraw.Draw(img)
    px = lambda t: 60 + (width - 70) * t / duration
    for i, ref in enumerate(refs):
        y0 = 12 + i * lane_h
        d.text((4, y0 + 14), names.get(ref, ref), fill=COLORS[ref], font=F14)
        d.line([60, y0 + lane_h - 4, width - 10, y0 + lane_h - 4], fill=(210, 205, 195))
        # typing bars
        on = None
        for e in trace["events"]:
            if e.get("ref") != ref:
                continue
            if e["kind"] == "typing":
                if e["on"] and on is None:
                    on = e["t"]
                elif not e["on"] and on is not None:
                    d.rectangle([px(on), y0 + 4, max(px(e["t"]), px(on) + 1), y0 + 12], fill=(240, 200, 60))
                    on = None
            elif e["kind"] == "chat":
                if on is not None:
                    d.rectangle([px(on), y0 + 4, max(px(e["t"]), px(on) + 1), y0 + 12], fill=(240, 200, 60))
                    on = None
                d.line([px(e["t"]), y0 + 14, px(e["t"]), y0 + 30], fill=COLORS[ref], width=2)
                if e["text"].rstrip().endswith("—"):
                    d.ellipse([px(e["t"]) - 4, y0 + 30, px(e["t"]) + 4, y0 + 38], fill=(220, 40, 40))
            elif e["kind"] == "gesture":
                x = px(e["t"])
                d.polygon([(x, y0 + 16), (x + 5, y0 + 22), (x, y0 + 28), (x - 5, y0 + 22)], fill=(40, 40, 160))
            elif e["kind"] == "expression" and e["face"] != "neutral":
                x = px(e["t"])
                d.ellipse([x - 3, y0 + 33, x + 3, y0 + 39], fill=(190, 60, 60))
        # walking segments
        walking = None
        for e in trace["events"]:
            if e["kind"] != "pos" or e["ref"] != ref:
                continue
            if e["state"] == "walk" and walking is None:
                walking = e["t"]
            elif e["state"] != "walk" and walking is not None:
                d.rectangle([px(walking), y0 + 40, max(px(e["t"]), px(walking) + 1), y0 + 43], fill=(60, 60, 60))
                walking = None
    y = 14 + lane_h * len(refs)
    d.text((60, y), "yellow = typing bubble   bar = line said   blue diamond = gesture   red dot = face   black = walking   red dot under a bar = line cut off by a dash", fill=(80, 80, 80), font=F10)
    for s in range(0, int(duration / 1000) + 1, 60):
        d.text((px(s * 1000) - 6, 0), f"{s}s", fill=(120, 120, 120), font=F10)
    return img


def sheet(arm, step_s, window):
    trace, layout = arm["trace"], arm["layout"]
    names = {a["ref"]: a["name"] for a in trace["actors"]}
    t0, t1 = window
    times = list(range(int(t0), int(t1) + 1, int(step_s)))
    cols = 5
    rows = math.ceil(len(times) / cols)
    pw, ph = layout["w"] * S + 8, layout["h"] * S + 46
    W = cols * pw + 8
    lanes = lane_chart(trace, W, (t1 + 5) * 1000, names)
    H = 54 + rows * ph + lanes.height
    img = Image.new("RGB", (W, H), (250, 248, 244))
    d = ImageDraw.Draw(img)
    m, sc = arm["metrics"], arm["score"]
    d.text((8, 6), f"run 63 on the Terraço  -  human_likeness {arm['likeness']}  -  human-likeness score {sc['score']}/100", fill=(20, 20, 20), font=F18)
    g = sc["groups"]
    d.text((8, 32), f"proxemics {g['proxemics']:.0f}  gaze {g['gaze']:.0f}  turns {g['turns']:.0f}  gesture {g['gesture']:.0f}  idle {g['idle']:.0f}   |   gestures/line {100 * (m['gesture']['perLine'] or 0):.0f}%   backchannel {100 * (m['backchannel']['rate'] or 0):.0f}%   typing r {m['typing']['lengthCorrelation']}   walks/actor-min {m['walks']['perActorMin']}   frozen {100 * (m['idle']['frozenShare'] or 0):.0f}%", fill=(70, 70, 70), font=F12)
    for i, ts in enumerate(times):
        ox = 4 + (i % cols) * pw + 4
        oy = 54 + (i // cols) * ph + 4
        draw_room(d, ox, oy, layout, trace, ts * 1000, names)
        last = None
        for e in trace["events"]:
            if e["kind"] == "chat" and e["t"] <= ts * 1000:
                last = e
        d.text((ox, oy + layout["h"] * S + 3), f"{ts}s", fill=(20, 20, 20), font=F12)
        if last:
            who = names.get(last["ref"], last["ref"])
            txt = f"{who}: {last['text']}"
            d.text((ox + 36, oy + layout["h"] * S + 3), txt[:46], fill=COLORS.get(last["ref"], (60, 60, 60)), font=F10)
            d.text((ox + 36, oy + layout["h"] * S + 16), txt[46:92], fill=COLORS.get(last["ref"], (60, 60, 60)), font=F10)
    img.paste(lanes, (0, 54 + rows * ph))
    return img


def main():
    args = sys.argv[1:]
    folder = Path(args[0])
    window = (10, 430)
    step = 30
    if "--window" in args:
        i = args.index("--window")
        window = (float(args[i + 1]), float(args[i + 2]))
    if "--step" in args:
        step = float(args[args.index("--step") + 1])
    arms = sorted(folder.glob("arm-h*.json"))
    for f in arms:
        arm = json.loads(f.read_text())
        out = folder / f.name.replace("arm-", "sheet-").replace(".json", ".png")
        sheet(arm, step, window).save(out)
        print(out)


if __name__ == "__main__":
    main()
