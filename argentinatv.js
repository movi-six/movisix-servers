/*
 * ArgentinaTV — TV en vivo por países (freetv.studio)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5. Un script por país: el país sale de CONFIG.country (código ISO, por defecto "AR").
 *
 * - La página del país (/es/country/AR) trae TODOS los canales en una sola página: no hay paginación.
 * - Cada canal tiene un único servidor: https://freetv.studio/embed/<id>
 * - La búsqueda filtra los canales de esa misma página (no depende del buscador del sitio).
 */

var BASE    = (CONFIG.base || "https://freetv.studio").replace(/\/+$/, "");
var COUNTRY = str(CONFIG.country || "AR").toUpperCase();
var LANG    = str(CONFIG.lang || "es");
var AUDIO   = str(CONFIG.audio || "LAT");

function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) { return util.htmlDecode(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }

function abs(u) {
  u = str(u).replace(/^\s+|\s+$/g, "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function norm(s) {
  return str(s).toLowerCase()
    .replace(/[áàäâ]/g, "a").replace(/[éèëê]/g, "e").replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o").replace(/[úùüû]/g, "u").replace(/ñ/g, "n");
}

function getHtml(url, referer) {
  var h = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1"
  };
  if (referer) h["Referer"] = referer;
  var body = http.get(url, h);
  if (!body) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return body;
}

// ───────────── Canales del país ─────────────
function allChannels() {
  var html = getHtml(BASE + "/" + LANG + "/country/" + COUNTRY, BASE + "/");
  var parts = String(html).split('<a data-ga-content="channel"');
  var out = [], seen = {};
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i], m;
    var id = (/data-ga-id="([^"]+)"/.exec(c) || [])[1];
    var href = (/href="(\/[^"]*\/channel\/[^"]+)"/.exec(c) || [])[1];
    if (!id || !href) continue;
    var url = abs(href);
    if (seen[url]) continue;
    seen[url] = true;

    var logo = (/<img src="(https?:[^"]+)"/.exec(c) || [])[1] || "";
    var title = (/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(c) || [])[1] || id;

    var cats = [];
    m = /<div class="flex flex-wrap gap-1\.5">([\s\S]*?)<\/div>/.exec(c);
    if (m) {
      var re = /<span[^>]*>([^<]+)<\/span>/g, x;
      while ((x = re.exec(m[1])) !== null) { var t = clean(x[1]); if (t) cats.push(t); }
    }
    out.push({ title: clean(title), url: url, image: logo, type: cats.join(", "), kind: "movie" });
  }
  return out;
}

// ───────────── Lista ─────────────
function list(page) {
  if ((page || 1) > 1) return [];       // todos los canales vienen en la primera página
  return allChannels();
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  if ((page || 1) > 1) return [];
  var words = norm(query).split(/\s+/), all = allChannels(), out = [];
  for (var i = 0; i < all.length; i++) {
    var hay = norm(all[i].title + " " + all[i].type), ok = true;
    for (var j = 0; j < words.length; j++) {
      if (words[j] && hay.indexOf(words[j]) === -1) { ok = false; break; }
    }
    if (ok) out.push(all[i]);
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url, BASE + "/"), m;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: false, episodes: [] };

  m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<header[^>]*>\s*<img src="(https?:[^"]+)"/.exec(html);
  if (m) d.poster = m[1];
  d.banner = d.poster;

  m = /<meta name="description" content="([^"]*)"/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = /href="\/[a-z]{2}\/country\/[^"]*"[^>]*>(?:<img[^>]*>)?\s*([^<]+)<\/a>/.exec(html);
  if (m) d.genres = "TV en vivo · " + clean(m[1]);

  d.episodes.push({ title: d.title || "En vivo", url: url, image: d.poster });
  return d;
}

// ───────────── Servidores ─────────────
// Un solo servidor por canal: la página embebible https://freetv.studio/embed/<id>
function servers(episodeUrl) {
  var m = /\/channel\/([^\/?#]+)/.exec(str(episodeUrl));
  if (!m) { log("ArgentinaTV: no se pudo sacar el id del canal de " + episodeUrl); return []; }
  return [{ url: BASE + "/embed/" + m[1], name: "FreeTV", audio: AUDIO, referer: BASE + "/" }];
}
