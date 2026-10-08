"""
draws one profile portrait per farmer in supabase/seed/farmers.json into public/farmers/<slug>.jpg (400 x 400).
    python3 supabase/seed/draw_portraits.py
illustrations only: no photos of real people are used.
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'farmers'

SKIN = ['#c68a62', '#b57a52', '#a86e48', '#d29a72', '#9a6340', '#c08058', '#b98660', '#8f5b3a']
KAMEEZ = ['#f3f0e6', '#e9e4d4', '#cfd9e0', '#b8c4b0', '#8c7a63', '#6f7f8c', '#d8cbb0', '#a9b7c6', '#5f6b52', '#e6dccb']
TURBAN = ['#f6f3ea', '#efe9d8', '#cfe0ea', '#e8c27a', '#d9d2c0', '#b7c9b8']
DUPATTA = ['#b84a62', '#3f7a6a', '#c27b2c', '#6a5a9c', '#2f6f9f', '#a3433c', '#5d8a3a', '#c45d8a', '#8a6d3b']
SHAWL = ['#7b5a43', '#5b5f63', '#8a7254', '#4f5a4a', '#94867a']


def shade(hex_color, f):
    c = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    c = [max(0, min(255, int(v * f))) for v in c]
    return '#%02x%02x%02x' % tuple(c)


def background(r):
    kind = r.choice(['field', 'field', 'wall', 'plain', 'brick', 'sky'])
    if kind == 'field':
        g = r.choice(['#7fa35a', '#6d9450', '#8bab62'])
        return f'''<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9cde3"/><stop offset="1" stop-color="#e6f0ee"/></linearGradient></defs>
<g filter="url(#blur)"><rect width="400" height="400" fill="url(#sky)"/><rect y="250" width="400" height="150" fill="{g}"/>
<ellipse cx="{r.randint(40,360)}" cy="255" rx="140" ry="22" fill="{shade(g,0.8)}"/><rect x="{r.randint(0,320)}" y="150" width="70" height="105" rx="30" fill="{shade(g,0.7)}"/>
<rect x="{r.randint(0,320)}" y="170" width="50" height="85" rx="22" fill="{shade(g,0.75)}"/></g>'''
    if kind == 'sky':
        return '''<g filter="url(#blur)"><rect width="400" height="400" fill="#bcd7e6"/><ellipse cx="80" cy="90" rx="90" ry="30" fill="#e8f2f7"/><ellipse cx="320" cy="60" rx="80" ry="24" fill="#eef5f8"/><rect y="300" width="400" height="100" fill="#9bb27a"/></g>'''
    if kind == 'wall':
        c = r.choice(['#e8dcc3', '#e3d3b6', '#ddd6c8', '#d9c9a8'])
        return f'''<g filter="url(#blur)"><rect width="400" height="400" fill="{c}"/><rect y="270" width="400" height="130" fill="{shade(c,0.9)}"/>
<rect x="{r.randint(250,330)}" y="60" width="60" height="120" fill="{shade(c,0.75)}"/></g>'''
    if kind == 'brick':
        rows = ''.join(f'<rect x="{(i % 2) * 30 - 30 + j * 60}" y="{i * 26}" width="56" height="22" fill="{r.choice(["#b9765a", "#c4805f", "#a96a50"])}"/>'
                       for i in range(16) for j in range(8))
        return f'<g filter="url(#blur)"><rect width="400" height="400" fill="#8f5642"/>{rows}</g>'
    c = r.choice(['#dfe7da', '#e9e2d0', '#d6e1e6', '#ece6da'])
    return f'<rect width="400" height="400" fill="{c}"/><circle cx="330" cy="70" r="140" fill="{shade(c,0.95)}"/>'


def portrait(f):
    r = random.Random(f['seed'])
    female, age = f['female'], f['age']
    skin = r.choice(SKIN)
    sk_d, sk_dd, sk_l = shade(skin, 0.86), shade(skin, 0.72), shade(skin, 1.08)
    old = age >= 52
    mid = 36 <= age < 52
    hair = '#d8d6d0' if age >= 60 else '#8d8a85' if old else '#1d1714'
    beard_c = '#e2e0da' if age >= 60 else '#9a958d' if old else '#1d1714'
    cloth = r.choice(KAMEEZ)
    hx, hy = 200 + r.randint(-6, 6), 188 + r.randint(-6, 6)
    rx, ry = (56, 70) if female else (60, 74)
    tilt = r.uniform(-4, 4)
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
         '<defs><filter id="blur"><feGaussianBlur stdDeviation="5"/></filter>'
         f'<radialGradient id="face" cx="0.42" cy="0.38" r="0.75"><stop offset="0" stop-color="{sk_l}"/><stop offset="0.7" stop-color="{skin}"/><stop offset="1" stop-color="{sk_d}"/></radialGradient>'
         f'<linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{shade(cloth,1.04)}"/><stop offset="1" stop-color="{shade(cloth,0.86)}"/></linearGradient>'
         '</defs>', background(r), '<g transform="translate(200 300) scale(1.28) translate(-200 -290)">']
    # body and neck
    s.append(f'<path d="M40 400 C48 330 110 300 160 292 L240 292 C290 300 352 330 360 400 Z" fill="url(#cloth)"/>')
    s.append(f'<path d="M172 250 L228 250 L232 300 Q200 318 168 300 Z" fill="{sk_d}"/>')
    if not female:
        s.append(f'<path d="M166 296 L200 340 L234 296" fill="none" stroke="{shade(cloth,0.7)}" stroke-width="3"/>'
                 f'<line x1="200" y1="340" x2="200" y2="400" stroke="{shade(cloth,0.75)}" stroke-width="2.5"/>'
                 f'<circle cx="200" cy="356" r="3" fill="{shade(cloth,0.6)}"/><circle cx="200" cy="378" r="3" fill="{shade(cloth,0.6)}"/>')
        if r.random() < 0.35:
            sh = r.choice(SHAWL)
            s.append(f'<path d="M40 400 C50 335 105 305 150 296 C150 330 120 370 112 400 Z" fill="{sh}"/>'
                     f'<path d="M150 296 C150 330 120 370 112 400" fill="none" stroke="{shade(sh,0.75)}" stroke-width="3"/>')
    s.append(f'<g transform="rotate({tilt:.1f} {hx} {hy})">')
    # dupatta back layer
    dup = r.choice(DUPATTA) if female else None
    if female:
        s.append(f'<path d="M{hx-92} 400 C{hx-100} 300 {hx-96} {hy-60} {hx-40} {hy-92} Q{hx} {hy-112} {hx+40} {hy-92} C{hx+96} {hy-60} {hx+100} 300 {hx+92} 400 Z" fill="{shade(dup,0.85)}"/>')
    # ears
    if not female:
        s.append(f'<ellipse cx="{hx-rx+2}" cy="{hy+6}" rx="11" ry="17" fill="{sk_d}"/><ellipse cx="{hx+rx-2}" cy="{hy+6}" rx="11" ry="17" fill="{sk_d}"/>')
    # face
    s.append(f'<ellipse cx="{hx}" cy="{hy}" rx="{rx}" ry="{ry}" fill="url(#face)"/>')
    # hair (under headwear)
    head = 'none' if female else r.choices(['turban', 'cap', 'hair', 'hair'], [3, 2, 3, 2])[0]
    if not female and head in ('hair',):
        if old and r.random() < 0.5:   # receding
            s.append(f'<path d="M{hx-rx} {hy-10} C{hx-rx} {hy-50} {hx-40} {hy-70} {hx-20} {hy-72} L{hx-30} {hy-40} C{hx-50} {hy-30} {hx-rx+6} {hy-20} {hx-rx+4} {hy+4} Z" fill="{hair}"/>'
                     f'<path d="M{hx+rx} {hy-10} C{hx+rx} {hy-50} {hx+40} {hy-70} {hx+20} {hy-72} L{hx+30} {hy-40} C{hx+50} {hy-30} {hx+rx-6} {hy-20} {hx+rx-4} {hy+4} Z" fill="{hair}"/>')
        else:
            s.append(f'<path d="M{hx-rx-2} {hy-2} C{hx-rx-6} {hy-70} {hx-30} {hy-96} {hx+6} {hy-92} C{hx+50} {hy-92} {hx+rx+6} {hy-60} {hx+rx+2} {hy-2} '
                     f'C{hx+rx-6} {hy-36} {hx+30} {hy-52} {hx} {hy-54} C{hx-34} {hy-52} {hx-rx+6} {hy-36} {hx-rx-2} {hy-2} Z" fill="{hair}"/>')
    # eyes, brows, nose, mouth
    ey = hy - 6
    for side in (-1, 1):
        ex = hx + side * 23
        s.append(f'<ellipse cx="{ex}" cy="{ey}" rx="11" ry="6" fill="#f4efe6"/><circle cx="{ex+r.choice([-1,0,1])}" cy="{ey}" r="5" fill="#2b1d14"/>'
                 f'<circle cx="{ex+1.5}" cy="{ey-1.5}" r="1.4" fill="#fff"/>'
                 f'<path d="M{ex-12} {ey-2} Q{ex} {ey-10} {ex+12} {ey-2}" fill="none" stroke="{sk_dd}" stroke-width="2"/>')
        bw = 3 if female else 5.5
        s.append(f'<path d="M{ex-14} {ey-17+ (2 if female else 0)} Q{ex} {ey-25} {ex+14} {ey-17}" fill="none" stroke="{hair if not female else "#1d1714"}" stroke-width="{bw}" stroke-linecap="round"/>')
        if old:
            s.append(f'<path d="M{ex+side*8} {ey+9} q{side*4} 3 {side*9} 1" fill="none" stroke="{sk_dd}" stroke-width="1.4"/>')
    s.append(f'<path d="M{hx-2} {ey+4} C{hx-6} {ey+24} {hx-12} {ey+32} {hx-8} {ey+36} Q{hx} {ey+40} {hx+9} {ey+35}" fill="none" stroke="{sk_dd}" stroke-width="2.4" stroke-linecap="round"/>')
    my = hy + 40
    lip = shade(skin, 0.68) if not female else shade('#a8524f', 0.95)
    s.append(f'<path d="M{hx-15} {my} Q{hx} {my+7} {hx+15} {my}" fill="{lip}" stroke="{shade(lip,0.8)}" stroke-width="1.2"/>')
    if old or mid:
        s.append(f'<path d="M{hx-26} {ey+30} Q{hx-30} {my} {hx-22} {my+14}" fill="none" stroke="{sk_dd}" stroke-width="1.6" opacity="0.6"/>'
                 f'<path d="M{hx+26} {ey+30} Q{hx+30} {my} {hx+22} {my+14}" fill="none" stroke="{sk_dd}" stroke-width="1.6" opacity="0.6"/>')
    if old:
        s.append(f'<path d="M{hx-26} {hy-44} q26 -6 52 0 M{hx-20} {hy-36} q20 -5 40 0" fill="none" stroke="{sk_dd}" stroke-width="1.3" opacity="0.55"/>')
    # facial hair
    if not female:
        style = r.choices(['full', 'short', 'stubble', 'mustache', 'none'], [5 if old else 3, 3, 2, 3 if mid else 2, 0 if old else 2])[0]
        if style in ('full', 'short'):
            low = hy + ry + (36 if style == 'full' else 12)
            s.append(f'<path d="M{hx-rx+4} {hy+4} C{hx-rx+2} {hy+50} {hx-36} {low} {hx} {low+4} C{hx+36} {low} {hx+rx-2} {hy+50} {hx+rx-4} {hy+4} '
                     f'C{hx+rx-12} {hy+44} {hx+26} {my+8} {hx} {my+10} C{hx-26} {my+8} {hx-rx+12} {hy+44} {hx-rx+4} {hy+4} Z" fill="{beard_c}"/>')
            s.append(f'<path d="M{hx-12} {my+4} Q{hx} {my+9} {hx+12} {my+4}" fill="{lip}"/>')
        elif style == 'stubble':
            s.append(f'<path d="M{hx-rx+6} {hy+10} C{hx-rx+8} {hy+56} {hx-30} {hy+ry} {hx} {hy+ry+2} C{hx+30} {hy+ry} {hx+rx-8} {hy+56} {hx+rx-6} {hy+10} Z" fill="{beard_c}" opacity="0.22"/>')
        if style in ('full', 'short', 'mustache', 'stubble'):
            s.append(f'<path d="M{hx-22} {my-3} Q{hx-10} {my-14} {hx} {my-8} Q{hx+10} {my-14} {hx+22} {my-3} Q{hx+10} {my-6} {hx} {my-3} Q{hx-10} {my-6} {hx-22} {my-3} Z" fill="{beard_c}"/>')
    # headwear
    if head == 'turban':
        c = r.choice(TURBAN)
        s.append(f'<path d="M{hx-rx-8} {hy-14} C{hx-rx-14} {hy-90} {hx-30} {hy-118} {hx+4} {hy-114} C{hx+44} {hy-116} {hx+rx+14} {hy-90} {hx+rx+8} {hy-14} '
                 f'C{hx+30} {hy-40} {hx-30} {hy-40} {hx-rx-8} {hy-14} Z" fill="{c}"/>')
        for k in range(4):
            s.append(f'<path d="M{hx-rx-6+k*4} {hy-26-k*18} C{hx-20} {hy-54-k*18} {hx+20} {hy-60-k*16} {hx+rx+2-k*6} {hy-34-k*18}" fill="none" stroke="{shade(c,0.82)}" stroke-width="3"/>')
        if r.random() < 0.5:
            s.append(f'<path d="M{hx+rx-6} {hy-60} q22 -28 14 -52 q-12 18 -24 30 Z" fill="{shade(c,0.95)}"/>')
    elif head == 'cap':
        c = r.choice(['#f7f5ef', '#f1ede2', '#e9e6dd'])
        s.append(f'<path d="M{hx-rx+2} {hy-30} C{hx-rx} {hy-86} {hx+rx} {hy-86} {hx+rx-2} {hy-30} Q{hx} {hy-42} {hx-rx+2} {hy-30} Z" fill="{c}"/>')
        for k in range(1, 6):
            s.append(f'<path d="M{hx-rx+6+k*2} {hy-36-k*7} Q{hx} {hy-46-k*7} {hx+rx-6-k*2} {hy-36-k*7}" fill="none" stroke="{shade(c,0.88)}" stroke-width="1.6" stroke-dasharray="3 3"/>')
    if female:
        s.append(f'<path d="M{hx-30} {hy-62} Q{hx} {hy-74} {hx+30} {hy-62} Q{hx+14} {hy-56} {hx} {hy-60} Q{hx-14} {hy-56} {hx-30} {hy-62} Z" fill="#1d1714"/>')
        s.append(f'<path d="M{hx-rx-18} 400 C{hx-rx-30} 320 {hx-rx-26} {hy-20} {hx-rx-6} {hy-60} C{hx-40} {hy-96} {hx+40} {hy-96} {hx+rx+6} {hy-60} '
                 f'C{hx+rx+26} {hy-20} {hx+rx+30} 320 {hx+rx+18} 400 L{hx+rx-4} 400 C{hx+rx+6} 320 {hx+rx+4} {hy+20} {hx+rx-4} {hy-24} '
                 f'C{hx+30} {hy-70} {hx-30} {hy-70} {hx-rx+4} {hy-24} C{hx-rx-4} {hy+20} {hx-rx-6} 320 {hx-rx+4} 400 Z" fill="{dup}"/>')
        s.append(f'<path d="M{hx-rx-6} {hy-60} C{hx-40} {hy-96} {hx+40} {hy-96} {hx+rx+6} {hy-60}" fill="none" stroke="{shade(dup,1.3)}" stroke-width="4" stroke-dasharray="2 6"/>')
        if r.random() < 0.5:
            s.append(f'<circle cx="{hx-9}" cy="{ey+34}" r="2.6" fill="#e2b33c"/>')
    if old and not female and r.random() < 0.3:
        s.append(f'<g fill="none" stroke="#3a2f28" stroke-width="2.6"><circle cx="{hx-23}" cy="{ey}" r="15"/><circle cx="{hx+23}" cy="{ey}" r="15"/><path d="M{hx-8} {ey} h16"/></g>')
    s.append('</g></g></svg>')
    return ''.join(s)


def main():
    from playwright.sync_api import sync_playwright
    farmers = json.loads((ROOT / 'supabase' / 'seed' / 'farmers.json').read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
        pg = br.new_page(viewport={'width': 400, 'height': 400})
        for f in farmers:
            pg.set_content(f'<html><body style="margin:0">{portrait(f)}</body></html>')
            pg.screenshot(path=str(OUT / f"{f['slug']}.jpg"), type='jpeg', quality=82, clip={'x': 0, 'y': 0, 'width': 400, 'height': 400})
        br.close()
    print(len(farmers), 'portraits in', OUT)


if __name__ == '__main__':
    main()
