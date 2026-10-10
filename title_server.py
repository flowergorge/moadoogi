"""로컬 HTML <title> 조회 서비스. 기존 file:// 저장 데이터를 보존한다."""
import ipaddress
import html
import json
import re
import socket
import webbrowser
from pathlib import Path
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

HOST, PORT = "127.0.0.1", 18976

def check_public_url(address):
    if not address or len(address) > 2048:
        raise ValueError("잘못된 주소")
    parts = urlsplit(address)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("HTTP(S) 주소만 지원")
    host = parts.hostname
    if host == "localhost" or host.endswith((".local", ".localhost", ".internal")):
        raise ValueError("내부 주소 제외")
    info = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80), type=socket.SOCK_STREAM)
    if not info or any(not ipaddress.ip_address(row[4][0]).is_global for row in info):
        raise ValueError("외부 공개 사이트 주소만 지원")
    return address

class PublicRedirects(HTTPRedirectHandler):
    def __init__(self):
        self.count = 0
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.count += 1
        if self.count > 5:
            raise ValueError("리디렉션 제한")
        check_public_url(urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class TitleParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_title = False
        self.parts = []
        self.social_title = ""
    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            props = dict(attrs)
            kind = (props.get("property") or props.get("name") or "").lower()
            if kind in ("og:title", "twitter:title") and props.get("content"):
                self.social_title = self.social_title or props["content"]
    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
    def handle_data(self, data):
        if self.in_title:
            self.parts.append(data)
    def result(self):
        title = " ".join("".join(self.parts).split())
        if not title or (len(title) <= 8 and self.social_title):
            title = self.social_title
        return " ".join(title.split())[:180]

def fetch_title(address):
    check_public_url(address)
    host = (urlsplit(address).hostname or "").lower()
    if host in ("youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"):
        # YouTube의 HTML 제목은 차단되거나 'YouTube'로만 보일 수 있다.
        oembed = "https://www.youtube.com/oembed?" + urlencode({"url": address, "format": "json"})
        try:
            with build_opener(ProxyHandler({}), PublicRedirects()).open(
                Request(oembed, headers={"User-Agent": "Mozilla/5.0"}), timeout=6
            ) as result:
                title = json.load(result).get("title", "")
                if title:
                    return str(title).strip()[:180]
        except (ValueError, HTTPError, URLError, TimeoutError, OSError):
            pass
    request = Request(address, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml", "Accept-Encoding": "identity",
    })
    with build_opener(ProxyHandler({}), PublicRedirects()).open(request, timeout=7) as response:
        if response.headers.get_content_type() not in ("text/html", "application/xhtml+xml"):
            raise ValueError("HTML 페이지가 아님")
        raw = response.read(500000)
        match = re.search(rb'<meta[^>]+charset\s*=\s*[\x22\x27]?([A-Za-z0-9_-]+)', raw[:8192], re.I)
        charset = match.group(1).decode("ascii") if match else response.headers.get_content_charset() or "utf-8"
        try:
            text = raw.decode(charset, errors="replace")
        except LookupError:
            text = raw.decode("utf-8", errors="replace")
    parser = TitleParser()
    parser.feed(text)
    return parser.result()

class PostParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.level = 0
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag == "p":
            self.level += 1
        elif tag == "br" and self.level:
            self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag == "p" and self.level:
            self.level -= 1
    def handle_data(self, data):
        if self.level:
            self.parts.append(data)

def fetch_x_post(address):
    check_public_url(address)
    host = (urlsplit(address).hostname or "").lower()
    if host not in ("x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"):
        raise ValueError("X 게시물 주소만 지원")
    if not re.search(r"/status/\d+", urlsplit(address).path):
        raise ValueError("개별 X 게시물이 아님")
    oembed = "https://publish.twitter.com/oembed?" + urlencode({"url": address, "omit_script": "true", "dnt": "true"})
    with build_opener(ProxyHandler({}), PublicRedirects()).open(
        Request(oembed, headers={"User-Agent": "Mozilla/5.0"}), timeout=7
    ) as response:
        result = json.load(response)
    markup = result.get("html", "")
    parser = PostParser()
    parser.feed(markup)
    name = str(result.get("author_name", "")).strip()
    profile_url = str(result.get("author_url", ""))
    handle = urlsplit(profile_url).path.strip("/").split("/")[0]
    if not handle:
        handle = urlsplit(address).path.strip("/").split("/")[0]
    if name and handle and name.casefold() != ("@" + handle).casefold():
        author = f"{name} (@{handle})"
    else:
        author = name or (f"@{handle}" if handle else "X 게시물")
    return {"text": "".join(parser.parts).strip()[:2500], "author": author[:180]}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path)
        if route.path == "/health":
            return self.send_json(200, {"ok": True})
        if route.path == "/player":
            vid = parse_qs(route.query).get("video", [""])[0]
            if not re.fullmatch(r"[\w-]{11}", vid):
                return self.send_json(400, {"error": "Invalid YouTube video ID"})
            markup = ('<!doctype html><html lang="ko"><head><meta charset="utf-8">'
                      '<meta name="referrer" content="strict-origin-when-cross-origin">'
                      '<style>html,body{margin:0;width:100%;height:100%;background:#141720}'
                      'iframe{width:100%;height:100%;border:0}</style></head><body>'
                      '<iframe src="https://www.youtube-nocookie.com/embed/'+vid+'?playsinline=1"'
                      ' allow="autoplay; encrypted-media; picture-in-picture"'
                      ' referrerpolicy="strict-origin-when-cross-origin" allowfullscreen'
                      ' title="YouTube 영상"></iframe></body></html>')
            data = markup.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        if route.path == "/api/x":
            url = parse_qs(route.query).get("url", [""])[0]
            try:
                post = fetch_x_post(url)
                return self.send_json(200, post) if post["text"] or post["author"] else self.send_json(422, {"error": "내용 없음"})
            except (ValueError, HTTPError, URLError, TimeoutError, OSError) as error:
                return self.send_json(422, {"error": str(error)[:140]})
        if route.path != "/api/title":
            return self.send_json(404, {"error": "Not found"})
        url = parse_qs(route.query).get("url", [""])[0]
        try:
            title = fetch_title(url)
            return self.send_json(200, {"title": title}) if title else self.send_json(422, {"error": "제목 없음"})
        except (ValueError, HTTPError, URLError, TimeoutError, OSError) as error:
            return self.send_json(422, {"error": str(error)[:140]})

    def send_json(self, code, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if self.headers.get("Origin") == "null":
            self.send_header("Access-Control-Allow-Origin", "null")
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"모아두기 메타데이터/동영상 서비스: http://{HOST}:{PORT}", flush=True)
    print("원래 브라우저 저장 데이터를 유지하도록 파일 주소로 엽니다. 종료: Ctrl+C", flush=True)
    webbrowser.open((Path(__file__).resolve().parent / "index.html").as_uri(), new=2)
    server.serve_forever()
