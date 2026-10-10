"""공식 웹사이트 아이콘을 프로젝트에 로컬 파일로 보관한다."""
from pathlib import Path
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ASSETS = Path(__file__).resolve().parent / "assets"
SOURCES = {
    "arca.svg": ("https://arca.live/static/assets/images/arca-logo-circle-web.svg",),
    "dcinside.ico": (
        "https://www.dcinside.com/favicon.ico",
        "https://gall.dcinside.com/favicon.ico",
        "https://www.google.com/s2/favicons?domain=dcinside.com&sz=128",
    ),
    "kone.ico": (
        "https://kone.gg/favicon.ico",
        "https://www.google.com/s2/favicons?domain=kone.gg&sz=128",
    ),
}
ASSETS.mkdir(exist_ok=True)
for name, urls in SOURCES.items():
    for url in urls:
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=10) as response:
                data = response.read(200001)
            if not 100 <= len(data) <= 200000:
                raise ValueError("unexpected size")
            if name.endswith(".svg"):
                if b"<svg" not in data[:3000]:
                    raise ValueError("not an SVG")
                # 아카라이브 공식 파일은 width=0인 스프라이트. 개별 심볼을 독립 SVG로 변환한다.
                root = ET.fromstring(data)
                symbol = next((el for el in root if el.tag.endswith("symbol")), None)
                if symbol is not None:
                    symbol.tag = "{http://www.w3.org/2000/svg}svg"
                    symbol.attrib.pop("id", None)
                    symbol.attrib.update({"width": "120", "height": "120", "viewBox": "0 0 120 120"})
                    for element in symbol:
                        if element.attrib.get("fill") == "currentColor":
                            element.set("fill", "#37a470")
                        if element.tag.endswith("g"):
                            element.set("fill", "#ffffff")
                    data = ET.tostring(symbol, encoding="utf-8", xml_declaration=True)
            elif not (data.startswith(b"\x00\x00\x01\x00") or data.startswith(b"\x89PNG")):
                raise ValueError("not an icon")
            target = ASSETS / (name[:-4] + ".png" if data.startswith(b"\x89PNG") else name)
            target.write_bytes(data)
            print(f"OK {target.name} {len(data)} bytes from {url}")
            break
        except Exception as exc:
            print(f"FAILED {name} from {url}: {exc}")
    else:
        print(f"UNAVAILABLE {name}")
