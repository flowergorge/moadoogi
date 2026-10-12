#!/usr/bin/env python3
"""Regenerate Android vectors and web bitmaps from assets/moadoogi-logo.svg.

Requires Inkscape and ImageMagick for PNG/ICO export; vector conversion is stdlib.
"""
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
RES = ROOT / 'android/app/src/main/res'
SVG = '{http://www.w3.org/2000/svg}'
ANDROID = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ANDROID)
source = ET.parse(ASSETS / 'moadoogi-logo.svg').getroot()
symbol = source.find(f"{SVG}g[@id='symbol']")
attrs = {'d': 'pathData', 'fill': 'fillColor', 'stroke': 'strokeColor',
         'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLineCap', 'stroke-linejoin': 'strokeLineJoin'}

def vector(paths, name):
    root = ET.Element('vector', {f'{{{ANDROID}}}{k}': v for k, v in
        {'width': '108dp', 'height': '108dp', 'viewportWidth': '108', 'viewportHeight': '108'}.items()})
    for path in paths:
        values = {f'{{{ANDROID}}}{dest}': path.attrib[key] for key, dest in attrs.items() if key in path.attrib}
        if 'fill' not in path.attrib:
            values[f'{{{ANDROID}}}fillColor'] = '#00000000'
        ET.SubElement(root, 'path', values)
    ET.indent(root)
    dest = RES / 'drawable' / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(dest, encoding='utf-8', xml_declaration=True)

vector(list(symbol), 'ic_launcher_foreground.xml')
vector([source.find(f"{SVG}path[@id='background']"), *symbol], 'ic_launcher.xml')
# One-color outline preserves the bookmark and tick in themed launchers.
mono = [ET.Element('path', {'d': 'M36 34H62Q68 34 68 40V82L49 71L30 82V40Q30 34 36 34Z',
        'stroke': '#FFFFFF', 'stroke-width': '4', 'stroke-linejoin': 'round'}),
        ET.Element('path', {'d': 'M40 51L47 58L59 46', 'stroke': '#FFFFFF',
        'stroke-width': '5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})]
vector(mono, 'ic_launcher_monochrome.xml')
(RES / 'values' / 'brand.xml').write_text('<resources><color name="brand_background">#6754D9</color></resources>\n')
for version in (26, 33):
    dest = RES / f'mipmap-anydpi-v{version}' / 'ic_launcher.xml'
    dest.parent.mkdir(parents=True, exist_ok=True)
    mono_line = '\n    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />' if version >= 33 else ''
    dest.write_text(f'''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="{ANDROID}">
    <background android:drawable="@color/brand_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />{mono_line}
</adaptive-icon>
''')
for size, name in [(32, 'favicon-32.png'), (180, 'apple-touch-icon.png')]:
    subprocess.run(['inkscape', str(ASSETS / 'moadoogi-logo.svg'), '--export-type=png',
        f'--export-filename={ASSETS / name}', f'--export-width={size}', f'--export-height={size}'], check=True)
subprocess.run(['convert', str(ASSETS / 'apple-touch-icon.png'), '-define',
    'icon:auto-resize=64,48,32,16', str(ASSETS / 'favicon.ico')], check=True)
