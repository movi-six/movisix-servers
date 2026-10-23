/*
 * SoloLatino — SoloLatino.net · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 *
 * Supone que el runtime ofrece http.get(url, headers) y http.post(url, body, headers),
 * ambos devolviendo el cuerpo como string. Si http.post tiene otra firma, solo hay que
 * ajustar la función apiCall().
 */

var BASE = (CONFIG.base || "https://sololatino.net").replace(/\/+$/, "");
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var warmed = false;

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function absOn(origin, u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return origin + (u.charAt(0) === "/" ? "" : "/") + u;
}

// ───────────── HTTP con cabeceras de navegador ─────────────
function browserHeaders(referer, extra) {
  var h = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
    "Referer": referer || (BASE + "/"),
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Chromium";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"'
  };
  if (extra) { for (var k in extra) h[k] = extra[k]; }
  return h;
}

function getHtml(url, referer, extra) {
  return http.get(url, browserHeaders(referer, extra));
}

function warmUp() {
  if (warmed) return;
  try { getHtml(BASE + "/"); } catch (e) {}
  warmed = true;
}

// ───────────── Tarjetas (lista y buscador) ─────────────
function parseCards(html) {
  var out = [], seen = {};
  var chunks = String(html).split('<div class="card">');
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i], m;
    m = /<a href="([^"]+)"/.exec(c);
    if (!m) continue;
    var url = abs(m[1]);
    if (seen[url]) continue;
    seen[url] = true;

    var img = (/<img[^>]+src="([^"]+)"/.exec(c) || [])[1] || "";
    var title = (/class="card__title">([^<]+)<\/span>/.exec(c) || /alt="([^"]+)"/.exec(c) || [])[1] || "";
    var rating = (/card__rating">★\s*([0-9.]+)/.exec(c) || [])[1] || "";
    var year = (/card__year">\s*([^<\s]+)\s*</.exec(c) || [])[1] || "";

    out.push({
      title: clean(title),
      url: url,
      image: abs(img),
      rating: rating,
      year: year,
      type: url.indexOf("/serie/") !== -1 ? "serie" : "movie"
    });
  }
  return out;
}

// ───────────── Lista ─────────────
function list(page) {
  page = page || 1;
  warmUp();
  var url = BASE + "/peliculas" + (page > 1 ? "?page=" + page : "");
  return parseCards(getHtml(url, BASE + "/"));
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  warmUp();
  var url = BASE + "/buscar?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
  try {
    return parseCards(getHtml(url, BASE + "/"));
  } catch (e) {
    log("SoloLatino search error: " + e);
    return [];
  }
}

// ───────────── Detalle ─────────────
function detail(url) {
  warmUp();
  var html = getHtml(url, BASE + "/"), m;
  var isSeries = url.indexOf("/serie/") !== -1;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: isSeries, episodes: [] };

  m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1].replace(/<[^>]+>/g, ""));

  m = /<img src="(https:\/\/image\.tmdb\.org\/t\/p\/w500\/[^"]+)"[\s\S]*?class="w-44 md:w-52 rounded-2xl shadow-2xl"/.exec(html);
  if (m) d.poster = m[1];
  m = /background-image:url\('(https:\/\/image\.tmdb\.org\/t\/p\/w1280\/[^']+)'\)/.exec(html);
  if (m) d.banner = m[1];
  if (!d.poster && d.banner) d.poster = d.banner;

  m = /<p class="text-sm leading-relaxed mb-6 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (!m) m = /<p class="text-sm leading-relaxed mb-5 max-w-2xl" style="color:#a0a0c8">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));

  m = /<span>(\d{4})<\/span>/.exec(html);
  if (m) d.year = m[1];

  m = /rating-badge__val">([^<]+)<\/span>/.exec(html);
  if (m) d.rating = m[1];

  var genres = [];
  var genreRe = /<a href="https:\/\/sololatino\.net\/genero\/[^"]+"[\s\S]*?>\s*([^<]+?)\s*<\/a>/g;
  while ((m = genreRe.exec(html)) !== null) {
    var g = clean(m[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }
  d.genres = genres.join(", ");

  if (isSeries) {
    var epRe = /<a href="([^"]+\/temporada-\d+\/episodio-\d+)"[\s\S]*?class="ep-thumb"[\s\S]*?<p class="ep-num">([^<]+)<\/p>[\s\S]*?<p class="text-sm font-semibold text-white leading-tight">\s*([\s\S]*?)<\/p>/g;
    while ((m = epRe.exec(html)) !== null) {
      d.episodes.push({ title: clean(m[2]) + " - " + clean(m[3]), url: abs(m[1]), image: "" });
    }
  }

  if (!isSeries || d.episodes.length === 0) {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Player (unlimplay): flujo /s.php ─────────────
// El HTML del embed no trae los servidores. El player hace:
//   POST /s.php a=1                  -> lista de servidores  {s:[[label,url],...]}
//   POST /s.php a=click              -> habilita la sesión
//   POST /s.php a=2 v=<url servidor> -> {type:"iframe",url} | {type:"mp4",u} | {u:<m3u8>,sig}
// Todas las peticiones llevan tok (del HTML), rt (_qv) y, tras el click, tk.

// FNV-1a de 32 bits, igual que _qh() del player (sin Math.imul).
function fnv(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0).toString(16);
}

function pageVars(html) {
  var t = /const _t\s*=\s*'([^']+)'/.exec(html);
  var qc = /var _qc\s*=\s*"([^"]+)"/.exec(html);
  var qk = /var _qk\s*=\s*\[([^\]]*)\]/.exec(html);
  if (!t || !qc || !qk) return null;
  var parts = [], re = /"([^"]*)"/g, m;
  while ((m = re.exec(qk[1])) !== null) parts.push(m[1]);
  if (parts.length < 4) return null;
  var qv = parts[1] + parts[3] + parts[0] + parts[2];
  return { tok: t[1], qv: qv, tk: fnv(qv + "|clk|" + qc[1]) };
}

function apiCall(origin, embed, vars, params, withTk) {
  var p = {};
  for (var k in params) p[k] = params[k];
  p.tok = vars.tok;
  p.rt = vars.qv;
  p.tk = withTk ? vars.tk : "";
  var body = [];
  for (var key in p) body.push(encodeURIComponent(key) + "=" + encodeURIComponent(p[key]));
  var res;
  try {
    res = http.post(origin + "/s.php", body.join("&"), {
      "User-Agent": UA,
      "Accept": "*/*",
      "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Origin": origin,
      "Referer": embed,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin"
    });
  } catch (e) {
    log("SoloLatino /s.php error: " + e);
    return null;
  }
  try { return JSON.parse(res); } catch (e2) {
    log("SoloLatino /s.php respuesta no JSON: " + String(res).substring(0, 200));
    return null;
  }
}

function doClick(origin, embed, vars) {
  var j = apiCall(origin, embed, vars, { a: "click", ts: "1" }, true);
  return !!(j && j.ok);
}

function resolveServer(origin, embed, vars, srvUrl) {
  var d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  if (d && d.type === "error" && d.msg === "no_click") {
    doClick(origin, embed, vars);
    d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  } else if (d && (d.error === "retry_once" || d.error === "busy")) {
    d = apiCall(origin, embed, vars, { a: "2", v: srvUrl }, true);
  }
  if (!d) return "";
  if (d.type === "iframe" && d.url) return d.url;
  if (d.type === "mp4" && d.u) return absOn(origin, d.u);
  if (d.u) {
    return origin + "/p.php?url=" + encodeURIComponent(d.u) + "&sig=" + encodeURIComponent(d.sig || "");
  }
  log("SoloLatino: servidor sin URL → " + JSON.stringify(d));
  return "";
}

function servers(episodeUrl) {
  warmUp();
  var html = getHtml(episodeUrl, BASE + "/");
  var isSeries = episodeUrl.indexOf("/serie/") !== -1;

  var m = /themoviedb\.org\/(?:movie|tv)\/(\d+)/.exec(html);
  if (!m) { log("SoloLatino: sin TMDB ID en " + episodeUrl); return []; }
  var tmdbId = m[1];

  var season = "1", episode = "1";
  if (isSeries) {
    season = (/temporada-(\d+)/.exec(episodeUrl) || [0, "1"])[1];
    episode = (/episodio-(\d+)/.exec(episodeUrl) || [0, "1"])[1];
  }

  var embed = isSeries
    ? "https://unlimplay.com/play/embed/tv/" + tmdbId + "/" + season + "/" + episode
    : "https://unlimplay.com/play/embed/movie/" + tmdbId;
  var origin = "https://unlimplay.com";

  var eh;
  try {
    eh = getHtml(embed, BASE + "/", { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "cross-site" });
  } catch (e) {
    log("SoloLatino: no se pudo abrir el embed: " + e);
    return [];
  }

  var vars = pageVars(eh);
  if (!vars) { log("SoloLatino: no se encontraron _t/_qk/_qc en el embed"); return []; }

  var scan = apiCall(origin, embed, vars, { a: "1" }, false);
  if (!scan || !scan.s || !scan.s.length) {
    log("SoloLatino: scan sin servidores → " + JSON.stringify(scan));
    return [];
  }

  if (!doClick(origin, embed, vars)) log("SoloLatino: click no confirmado, se intenta igual");

  var out = [];
  for (var i = 0; i < scan.s.length; i++) {
    var srv = scan.s[i]; // [label, url]
    var real = resolveServer(origin, embed, vars, srv[1]);
    if (real && out.indexOf(real) === -1) out.push(real);
  }
  return out;
}
