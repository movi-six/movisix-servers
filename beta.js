/*
 * Beta — HentaiLA (hentaila.com)  · contenido adulto
 * Funciones: list(page) · search(query) · detail(url) · servers(episodeUrl)
 * CONFIG.base = dominio · CONFIG.cdn = host de imágenes (opcional, por defecto cdn.hentaila.com)
 * ES5. Usa [\s\S] en vez de . con la bandera s.
 */

var BASE = (CONFIG.base || "https://hentaila.com").replace(/\/+$/, "");
var CDN = String(CONFIG.cdn || "cdn.hentaila.com").replace(/\./g, "\\.");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function abs(u) {
  u = String(u || "");
  if (/^https?:\/\//i.test(u)) return u;
  return BASE + (u.charAt(0) === "/" ? u : "/" + u);
}

// Tarjetas: <article> … src="cdn…" … <h3>título</h3> … href="/media/…"
function parseCards(html) {
  var out = [], m;
  var re = new RegExp(
    "<article[^>]*>[\\s\\S]*?" +
    "src=\"(https?:\\/\\/" + CDN + "\\/[^\"]+)\"[\\s\\S]*?" +
    "<h3[^>]*>([^<]+)<\\/h3>[\\s\\S]*?" +
    "href=\"(\\/media\\/[^\"]+)\"", "g");
  while ((m = re.exec(html)) !== null) {
    out.push({ url: abs(m[3]), image: m[1], title: clean(m[2]) });
  }
  return out;
}

function list(page) {
  return parseCards(get(BASE + "/catalogo?order=latest_released&page=" + (page || 1)));
}

function search(query) {
  return parseCards(get(BASE + "/catalogo?search=" + encodeURIComponent(query) + "&page=1"));
}

function detail(pageUrl) {
  var html = get(pageUrl);
  var d = {}, m;

  m = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<h2[^>]*>([^<]+)<\/h2>/.exec(html);
  if (m) d.altTitle = clean(m[1]);

  var g = [], gre = /<a[^>]*href="\/catalogo\?genre=[^"]+"[^>]*>([^<]+)<\/a>/g;
  while ((m = gre.exec(html)) !== null) g.push(clean(m[1]));
  if (g.length) d.genres = g.join(", ");

  m = /<div class="entry[^>]*>[\s\S]*?<p[^>]*>([^<]+)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = new RegExp("src=\"(https?:\\/\\/" + CDN + "\\/backdrops\\/[^\"]+)\"").exec(html);
  if (m) d.banner = m[1];

  // Episodios: /media/<slug>/<número>
  var eps = [], seen = {};
  var lre = /href="(\/media\/[^"]+\/\d+)"/g;
  var imgRe = new RegExp("src=\"(https?:\\/\\/" + CDN + "\\/screenshots\\/[^\"]+)\"");
  while ((m = lre.exec(html)) !== null) {
    var raw = m[1];
    if (seen[raw]) continue;
    seen[raw] = true;
    var parts = raw.split("/");
    var num = parts[parts.length - 1];
    var img = "";
    var idx = html.indexOf(raw);
    if (idx !== -1) {
      var im = imgRe.exec(html.substring(idx, Math.min(idx + 600, html.length)));
      if (im) img = im[1];
    }
    eps.push({ url: abs(raw), image: img, title: "Episodio " + num });
  }

  // Respaldo: enlaces sueltos "Episodio N"
  if (!eps.length) {
    var loose = /href="(\/media\/[^"]+)"[^>]*>[\s\S]*?Episodio\s+(\d+)/g;
    while ((m = loose.exec(html)) !== null) {
      if (seen[m[1]]) continue;
      seen[m[1]] = true;
      eps.push({ url: abs(m[1]), image: "", title: "Episodio " + m[2] });
    }
  }
  d.episodes = eps;
  return d;
}

// ───────────── Servidores ─────────────

function servers(episodeUrl) {
  var html = get(episodeUrl);
  var out = [];

  function add(u) { if (/^https?:/.test(u) && out.indexOf(u) < 0) out.push(u); }

  // Sección "embeds" … hasta "downloads"
  var es = html.indexOf("\"embeds\"");
  if (es === -1) es = html.indexOf("embeds:");
  if (es !== -1) {
    var ds = html.indexOf("downloads", es);
    if (ds !== -1) {
      var sec = html.substring(es, ds);
      var re = /server["']?\s*:\s*["'][^"']*["'][\s\S]{0,50}?url["']?\s*:\s*["']([^"']+)["']/g, m;
      while ((m = re.exec(sec)) !== null) add(m[1]);
    }
  }

  // Respaldo: dominios conocidos
  if (!out.length) {
    var known = ["hvidserv.com", "mega.nz", "yourupload.com", "mp4upload.com", "hqq.ac", "vidhide.com",
                 "voe.sx", "streamtape.com", "doodstream.com", "filemoon.sx", "streamwish.com", "okru.com"];
    for (var i = 0; i < known.length; i++) {
      var re2 = new RegExp("[\"'](https?:\\/\\/[^\"'\\s]*" + known[i].replace(/\./g, "\\.") + "[^\"'\\s]*)[\"']", "g"), n;
      while ((n = re2.exec(html)) !== null) add(n[1].replace(/^\s+|\s+$/g, ""));
    }
  }
  return out;
}
