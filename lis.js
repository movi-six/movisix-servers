/*
 * LIS — sextb.net · JAV (HTTP puro, sin WebView)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(detailUrl)
 * Flujo de servers(): GET detalle → filmId/__pt/__pk/botones → POST /ajax/player por botón → XOR(player_enc, __pk) → iframe.
 * Las cookies de sesión se reenvían solas dentro de la misma llamada. ES5.
 */

var BASE = (CONFIG.base || "https://sextb.net").replace(/\/+$/, "");
var UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
];

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }

// GET con rotación de User-Agent (el sitio devuelve 403 según el UA)
function get(url) {
  for (var i = 0; i < UAS.length; i++) {
    var h = http.get(url, {
      "User-Agent": UAS[i],
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Upgrade-Insecure-Requests": "1",
      "Referer": "https://www.google.com/"
    });
    if (h) return h;
    if (http.status() !== 403) break;
  }
  throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
}

function post(url, body, referer) {
  for (var i = 0; i < UAS.length; i++) {
    var h = http.post(url, body, {
      "User-Agent": UAS[i],
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": BASE,
      "Referer": referer || BASE + "/"
    });
    if (h) return h;
    if (http.status() !== 403) break;
  }
  throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
}

function first(html, re) { var m = re.exec(html); return m ? m[1] : null; }

function list(page) {
  page = page || 1;
  var html = get(BASE + "/jav-uncensored-2y43dtnm?genre=all&studio=all&quality=all&year=all&sort=release" + (page > 1 ? "&pg=" + page : ""));
  var out = [], m;
  var re = /<div class="tray-item[^"]*">\s*<a href="(\/[^"]+)">\s*<img[^>]+data-src="([^"]+)"[^>]+alt="([^"]+)"[\s\S]*?<div class="tray-item-code">([^<]+)<\/div>[\s\S]*?<div class="tray-item-runtime">([^<]+)<\/div>/g;
  while ((m = re.exec(html)) !== null) {
    out.push({ url: BASE + trim(m[1]), image: trim(m[2]), title: clean(m[3]), subtitle: trim(m[4]).toUpperCase(), year: trim(m[5]) });
  }
  if (!out.length) {
    var fb = /<a href="(\/[^"]+)">\s*<img[^>]+data-src="([^"]+)"[^>]+alt="([^"]+)"/g;
    while ((m = fb.exec(html)) !== null) {
      var path = trim(m[1]);
      if (path === "/" || path.indexOf("/js") === 0 || path.indexOf("/css") === 0) continue;
      out.push({ url: BASE + path, image: trim(m[2]), title: clean(m[3]) });
    }
  }
  return out;
}

function search(query, page) {
  page = page || 1;
  var html = get(BASE + "/search/" + encodeURIComponent(query) + (page > 1 ? "?pg=" + page : ""));
  var out = [], m;
  var re = /<div class="tray-item[^"]*">\s*<a href="(\/[^"]+)">\s*<img[^>]+data-src="([^"]+)"[^>]+alt="([^"]+)"/g;
  while ((m = re.exec(html)) !== null) out.push({ url: BASE + trim(m[1]), image: trim(m[2]), title: clean(m[3]) });
  return out;
}

// Lee la página de detalle: título, póster y datos que necesita el POST de reproductores
function parsePage(html) {
  var p = { buttons: [] };
  var t = first(html, /<h1 class="film-info-title"><strong><a[^>]+>([^<]+)<\/a>/) || first(html, /<h1[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/);
  if (t) p.title = clean(t);
  var im = first(html, /<meta property="og:image" content="([^"]+)"/);
  if (im) p.image = trim(im);
  p.filmId = first(html, /var\s+filmId\s*=\s*(\d+)/);
  p.pt = first(html, /window\.__pt\s*=\s*['"]([^'"]+)['"]/);
  p.pk = first(html, /window\.__pk\s*=\s*['"]([^'"]+)['"]/);
  var m, re = /class="btn-player\s+episode[^"]*"[^>]+data-source="(\d+)"[^>]+data-id="(\d+)"[^>]*>(?:<i[^>]+><\/i>)?\s*([^<]+)<\/button>/g;
  while ((m = re.exec(html)) !== null) p.buttons.push({ source: trim(m[1]), id: trim(m[2]), name: trim(m[3]) });
  return p;
}

function detail(url) {
  var p = parsePage(get(url));
  var d = { isSeries: false, episodes: [{ title: p.title || "Ver", url: url, image: p.image || "" }] };
  if (p.title) d.title = p.title;
  if (p.image) d.poster = p.image;
  return d;
}

function embedUrl(html) {
  if (!html) return null;
  var u = first(html, /<iframe[^>]+src=['"]([^'"]+)['"]/);
  if (u && u.indexOf("http") === 0) return trim(u);
  u = first(html, /['"]file['"]:\s*['"]([^'"]+)['"]/);
  if (u && u.indexOf("http") === 0) return trim(u);
  u = first(html, /<source[^>]+src=['"]([^'"]+)['"]/);
  if (u && u.indexOf("http") === 0) return trim(u);
  u = first(html, /(https?:\/\/[^\s'"<>]+\.(?:m3u8|mp4|mkv)[^\s'"<>]*)/);
  if (u) return trim(u);
  u = first(html, /(https?:\/\/[^\s'"<>]{15,})/);
  return u ? trim(u) : null;
}

function servers(detailUrl) {
  var p = parsePage(get(detailUrl));
  var out = [];
  if (!p.filmId || !p.buttons.length) return out;
  var pt = p.pt, pk = p.pk;

  for (var i = 0; i < p.buttons.length; i++) {
    try {
      var body = "episode=" + encodeURIComponent(p.buttons[i].id) + "&filmId=" + encodeURIComponent(p.filmId);
      if (pt) body += "&pt=" + encodeURIComponent(pt);
      var raw = post(BASE + "/ajax/player", body, detailUrl);
      var j = null;
      try { j = JSON.parse(raw); } catch (e) { j = null; }
      var enc = j ? j.player_enc : first(raw, /"player_enc"\s*:\s*"([^"]*)"/);
      if (!enc) throw new Error("player_enc no encontrado");
      var nextPt = j ? j.next_pt : first(raw, /"next_pt"\s*:\s*"([^"]*)"/);
      var nextPk = j ? j.next_pk : first(raw, /"next_pk"\s*:\s*"([^"]*)"/);
      var url = embedUrl(util.xorDecrypt(enc, pk || ""));
      if (nextPt) pt = nextPt;
      if (nextPk) pk = nextPk;
      if (url) out.push({ url: url, name: "Server " + (out.length + 1), referer: BASE + "/" });
    } catch (e2) { log("LIS botón " + p.buttons[i].id + ": " + e2); }
  }
  return out;
}
