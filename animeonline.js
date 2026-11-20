/*
 * AnimeOnline — animeonline.ninja (tema DooPlay)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5. Sin DOM: todo se extrae con regex del HTML.
 *
 * Cloudflare: este script NO toca User-Agent ni cookies. Si el sitio pide verificación,
 * la app abre CfVerifyActivity y luego inyecta cookie + UA en cada petición.
 */

var BASE = (CONFIG.base || "https://ww3.animeonline.ninja").replace(/\/+$/, "");

// ───────────── Utilidades ─────────────
function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) { return util.htmlDecode(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }
function cap(s) { s = str(s); return s ? s.charAt(0).toUpperCase() + s.substring(1) : s; }

function abs(u) {
  u = str(u).replace(/^\s+|\s+$/g, "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// Quita sufijos de miniatura de WordPress: poster-185x278.jpg -> poster.jpg
function bigImg(u) { return abs(u).replace(/-\d+x\d+\./, "."); }

function attr(tag, name) {
  var m = new RegExp("(?:^|[\\s\"'])" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i").exec(tag || "");
  return m ? m[2] : "";
}

function imgOf(html) {
  var m = /<img\b[^>]*>/i.exec(html || "");
  if (!m) return "";
  return attr(m[0], "data-src") || attr(m[0], "data-lazy-src") || attr(m[0], "src");
}

// Parte el HTML en trozos que empiezan en cada etiqueta cuyo class contiene TODAS las clases dadas.
function chunksByClass(html, classes) {
  html = str(html);
  var re = /<(article|div|li)\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>/gi, idx = [], m;
  while ((m = re.exec(html)) !== null) {
    var have = " " + m[2].replace(/\s+/g, " ") + " ", ok = true;
    for (var i = 0; i < classes.length; i++) if (have.indexOf(" " + classes[i] + " ") === -1) { ok = false; break; }
    if (ok) idx.push(m.index);
  }
  var out = [];
  for (var k = 0; k < idx.length; k++) out.push(html.substring(idx[k], k + 1 < idx.length ? idx[k + 1] : html.length));
  return out;
}

// Devuelve el HTML interno del <div> que empieza en `startRe` (cuenta divs anidados hasta cerrarlo).
// Si no lo encuentra devuelve "".
function sliceDiv(html, startRe) {
  html = str(html);
  var m = startRe.exec(html);
  if (!m) return "";
  var from = m.index + m[0].length, depth = 1, re = /<(\/?)div\b/gi, t;
  re.lastIndex = from;
  while ((t = re.exec(html)) !== null) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.substring(from, t.index);
  }
  return html.substring(from);
}

function kindOf(url) { return /\/(pelicula|peliculas|movies?)\//i.test(url) ? "movie" : "serie"; }

// ───────────── HTTP ─────────────
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

// ───────────── Lista ─────────────
function list(page) {
  page = page || 1;
  var url = BASE + "/online/" + (page > 1 ? "page/" + page + "/" : "");
  var html = getHtml(url, BASE + "/");
  // Solo el listado real: <div id="archive-content">. El resto de la página (destacados, sliders)
  // trae cards "item tvshows" que se repiten en todas las páginas.
  var area = sliceDiv(html, /<div[^>]*\bid=["']archive-content["'][^>]*>/i);
  if (!area) { log("AnimeOnline: no se encontró #archive-content en " + url); return []; }
  var out = [], seen = {}, cards = chunksByClass(area, ["item", "tvshows"]);
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var a = /<h3[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(c);
    if (!a) continue;
    var u = abs(a[1]);
    if (seen[u]) continue;
    seen[u] = true;
    var r = /class=["']rating["'][^>]*>[\s\S]*?<\/span>\s*([0-9]+(?:\.[0-9]+)?)/i.exec(c);
    var y = /class=["']metadata["'][^>]*>[\s\S]*?<span>\s*(\d{4})\s*<\/span>/i.exec(c);
    out.push({ title: clean(a[2]), url: u, image: bigImg(imgOf(c)), rating: r ? r[1] : "", year: y ? y[1] : "", kind: kindOf(u) });
  }
  return out;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  var url = BASE + "/search/" + (page > 1 ? "page/" + page + "/" : "") + "?s=" + encodeURIComponent(query);
  var html = getHtml(url, BASE + "/");
  var out = [], seen = {}, cards = chunksByClass(html, ["result-item"]);
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var a = /class=["'][^"']*\btitle\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(c);
    if (!a) continue;
    var u = abs(a[1]);
    if (seen[u]) continue;
    seen[u] = true;
    var y = /class=["'][^"']*\byear\b[^"']*["'][^>]*>([^<]*)</i.exec(c);
    out.push({ title: clean(a[2]), url: u, image: bigImg(imgOf(c)), year: y ? clean(y[1]) : "", kind: kindOf(u) });
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url, BASE + "/"), m;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: false, seasons: [], episodes: [] };

  m = /<div[^>]*class=["'][^"']*\bdata\b[^"']*["'][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<div[^>]*class=["'][^"']*\bposter\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (m) d.poster = bigImg(imgOf(m[1]));

  m = /class=["'][^"']*\bsgeneros\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (m) {
    var g = [], re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi, x;
    while ((x = re.exec(m[1])) !== null) { var t = clean(x[1]); if (t && g.indexOf(t) === -1) g.push(t); }
    d.genres = g.join(", ");
  }

  m = /<div[^>]*class=["'][^"']*\bwp-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html) ||
      /<div[^>]*class=["'][^"']*\bdescription\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = /class=["'][^"']*\bdate\b[^"']*["'][^>]*>[^<]*?(\d{4})/i.exec(html);
  if (m) d.year = m[1];

  // Temporadas: <div class="se-c"> ... <ul class="episodios"><li>...<a href>título</a>
  var blocks = chunksByClass(html, ["se-c"]);
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var tm = /class=["'][^"']*\bse-q\b[^"']*["'][^>]*>[\s\S]*?class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(b) ||
             /class=["'][^"']*\bse-t\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(b);
    var stitle = tm ? clean(tm[1].split("<")[0]) : ("Temporada " + (i + 1));
    // Solo los <li> de <ul class="episodios">. El último bloque se-c se extiende hasta el final de la
    // página, así que sin acotar a esta lista se colaban menús, sidebar y footer como "episodios".
    var eps = [], seenEp = {};
    var ul = /<ul\b[^>]*class=["'][^"']*\bepisodios\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(b);
    var lis = ul ? ul[1].split(/<li\b/i) : [];
    for (var j = 1; j < lis.length; j++) {
      var li = lis[j];
      var a = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(li);
      if (!a) continue;
      var eu = abs(a[1]);
      if (seenEp[eu]) continue;
      seenEp[eu] = true;
      eps.push({ title: clean(a[2]) || ("Episodio " + j), url: eu, image: bigImg(imgOf(li)) });
    }
    if (eps.length) {
      d.seasons.push({ title: stitle, episodes: eps });
      for (var k = 0; k < eps.length; k++) d.episodes.push(eps[k]);
    }
  }

  d.isSeries = d.seasons.length > 0;
  if (!d.isSeries) {
    // Película: un único "episodio" que es la propia página
    d.seasons = [];
    d.episodes = [{ title: "Película", url: url, image: d.poster }];
  }
  return d;
}

// ───────────── Servidores ─────────────
// El iframe del player NO viene en el HTML del episodio (lo arma el JS de la página). Se obtiene así:
//   html  → <iframe src=...> real en el HTML plano (se ignoran about:/blob:/data:)
//   scan  → cualquier URL ".../embed.php?id=..." escrita en el HTML
//   api   → POST /wp-admin/admin-ajax.php (action=doo_player_ajax) en el dominio REAL del episodio
//           (ww4, no BASE) → {"embed_url":"https://saidochesto.top/embed.php?id=...","type":"iframe"}
// Luego el iframe se pide por HTTP (la app inyecta la cookie de Cloudflare de ese host)
// y se leen los go_to_player('url') de cada <div class="OD OD_xxx">. Sin WebView.
//
// DIAGNÓSTICO: si nada da servidores, servers() LANZA un Error con el detalle de cada paso.

function audioOf(code) {
  code = str(code).toUpperCase();
  if (code === "LAT") return "LAT";
  if (code === "ES" || code === "CAS") return "CAS";
  if (code === "EN" || code === "ENG") return "ENG";
  return "SUB";
}

// El desafío de Cloudflare NO se debe tragar: tiene que llegar a la app para que abra la verificación.
function isCf(e) {
  return /cloudflare|verificaci[oó]n/i.test(str(e && e.message) + " " + str(e));
}

function snip(s, n) { return str(s).replace(/\s+/g, " ").substring(0, n || 160); }
function shortUrl(u) { return str(u).replace(/^https?:\/\//i, "").substring(0, 70); }
// Una página normal también carga scripts de Cloudflare: solo cuenta como desafío si es corta o dice "Just a moment".
function looksCf(h) {
  h = str(h);
  return /just a moment|attention required|cf-browser-verification/i.test(h) ||
         (h.length < 30000 && /challenge-platform|cf-chl/i.test(h));
}
function originOf(u) { var m = /^(https?:\/\/[^\/?#]+)/i.exec(str(u)); return m ? m[1] : ""; }

// src real de un <iframe>: ignora about:/data:/blob: (los arma el JS de la página) y prueba los data-*.
function iframeSrc(tag) {
  var c = [attr(tag, "src"), attr(tag, "data-src"), attr(tag, "data-lazy-src"), attr(tag, "data-litespeed-src")];
  for (var i = 0; i < c.length; i++) {
    var s = str(c[i]).replace(/^\s+|\s+$/g, "");
    if (!s || /^(about:|data:|javascript:|blob:)/i.test(s)) continue;
    return abs(util.htmlDecode(s));
  }
  return "";
}

function playerFromHtml(html) {
  var tags = str(html).match(/<iframe\b[^>]*>/gi) || [];
  var i, s;
  for (i = 0; i < tags.length; i++) {
    if (/metaframe/i.test(attr(tags[i], "class"))) { s = iframeSrc(tags[i]); if (s) return s; }
  }
  for (i = 0; i < tags.length; i++) {
    s = iframeSrc(tags[i]);
    if (s && !/youtube|facebook|twitter|disqus/i.test(s)) return s;
  }
  return "";
}

// URL ".../embed.php?id=..." escrita en cualquier parte del texto (también con \/ escapadas).
function scanEmbed(text) {
  var h = str(text).replace(/\\\//g, "/");
  var m = /(?:https?:)?\/\/[A-Za-z0-9.\-]+\/embed\.php\?id=[A-Za-z0-9_\-]+/i.exec(h);
  return m ? abs(m[0]) : "";
}

// Opciones del reproductor DooPlay: <li class="dooplay_player_option" data-post data-nume data-type>
function playerOptions(html) {
  var tags = str(html).match(/<li\b[^>]*dooplay_player_option[^>]*>/gi) || [], out = [], seen = {};
  for (var i = 0; i < tags.length && out.length < 6; i++) {
    var post = attr(tags[i], "data-post"), nume = attr(tags[i], "data-nume"), type = attr(tags[i], "data-type") || "tv";
    if (!post || !nume || seen[post + "/" + nume]) continue;
    seen[post + "/" + nume] = true;
    out.push({ post: post, nume: nume, type: type });
  }
  return out;
}

// De una respuesta de la API (JSON, <iframe ...> o texto) saca la URL del embed.
function parseEmbed(r) {
  r = str(r);
  if (!r) return "";
  var e = r, mm;
  try { var j = JSON.parse(r); if (j && j.embed_url) e = str(j.embed_url); } catch (x) { }
  var sc = scanEmbed(e);
  if (sc) return sc;
  mm = /src=["']([^"']+)["']/i.exec(e);
  if (mm && !/^(about:|data:|blob:|javascript:)/i.test(mm[1])) return abs(util.htmlDecode(mm[1]));
  if (/^https?:\/\//i.test(e.replace(/^\s+/, ""))) return e.replace(/^\s+|\s+$/g, "");
  return "";
}

// Pide la URL del player de UNA opción con admin-ajax de DooPlay, en el dominio real del episodio.
// (El REST /wp-json/dooplayer/v1 y el GET de admin-ajax devuelven null en este sitio; el POST sí funciona.)
function playerFromApi(opt, episodeUrl, origin, notes) {
  var tag = "api" + opt.nume, r, u;
  try {
    var h = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", "Referer": episodeUrl, "Origin": origin };
    r = http.post(origin + "/wp-admin/admin-ajax.php",
      "action=doo_player_ajax&post=" + encodeURIComponent(opt.post) + "&nume=" + encodeURIComponent(opt.nume) + "&type=" + encodeURIComponent(opt.type), h);
    u = parseEmbed(r);
    if (u) return u;
    notes.push(tag + " ajax (HTTP " + http.status() + "): sin embed_url → " + snip(r, 100));
  } catch (e) {
    if (isCf(e)) throw e;
    notes.push(tag + " ajax falló: " + snip(e, 100));
  }
  return "";
}

function hostName(u) {
  var m = /^https?:\/\/(?:www\.)?([^\/:?#]+)/i.exec(str(u));
  return m ? cap(m[1].split(".")[0]) : "Servidor";
}

// Pide el iframe por HTTP y extrae los servidores por idioma. Anota en `notes` lo que pase.
function fromIframe(iframe, episodeUrl, notes) {
  var tag = shortUrl(iframe), ih = "", ih2 = "";
  try { ih = getHtml(iframe, episodeUrl); } catch (e1) { if (isCf(e1)) throw e1; notes.push("iframe " + tag + " (referer episodio) falló: " + snip(e1, 100)); }
  if (!ih || ih.indexOf("go_to_player") === -1) {
    try { ih2 = getHtml(iframe, (originOf(episodeUrl) || BASE) + "/"); } catch (e2) { if (isCf(e2)) throw e2; notes.push("iframe " + tag + " (referer base) falló: " + snip(e2, 100)); }
    if (ih2) ih = ih2;
  }

  if (!ih) {
    notes.push("iframe " + tag + ": respuesta vacía");
    return [];
  }
  if (ih.indexOf("go_to_player") === -1) {
    notes.push("iframe " + tag + ": " + ih.length + " bytes SIN go_to_player" + (looksCf(ih) ? " (parece Cloudflare)" : "") + " → " + snip(ih, 120));
    return [];
  }

  var out = [], seen = {};
  function addFrom(chunk, audio) {
    var re = /go_to_player\(\s*['"]([^'"]+)['"]\s*\)/g, x;
    while ((x = re.exec(chunk)) !== null) {
      var u = util.htmlDecode(x[1]);
      if (seen[u]) continue;
      seen[u] = true;
      out.push({ url: u, name: hostName(u), audio: audio, referer: iframe });
    }
  }

  var reOD = /<div\b[^>]*class\s*=\s*["']\s*OD\s+OD_([A-Za-z0-9_\-]+)[^"']*["'][^>]*>/gi, marks = [], m;
  while ((m = reOD.exec(ih)) !== null) marks.push({ at: m.index, code: m[1] });
  for (var i = 0; i < marks.length; i++) {
    addFrom(ih.substring(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : ih.length), audioOf(marks[i].code));
  }
  if (out.length === 0) addFrom(ih, "SUB");   // último recurso: cualquier go_to_player

  if (out.length === 0) notes.push("iframe " + tag + ": hay go_to_player pero no se pudo leer ninguna URL");
  return out;
}

function servers(episodeUrl) {
  var html = getHtml(episodeUrl, BASE + "/");
  var origin = originOf(episodeUrl) || BASE;
  var notes = [], tried = {}, direct = [];
  var nIframes = (str(html).match(/<iframe\b/gi) || []).length;
  var opts = playerOptions(html);
  notes.push("episodio en " + shortUrl(origin) + ": " + str(html).length + " bytes, " + nIframes + " iframes, " + opts.length + " opciones dooplay" + (looksCf(html) ? " (parece Cloudflare)" : ""));

  function attempt(iframe, how) {
    if (!iframe) { notes.push(how + ": no se encontró iframe"); return []; }
    if (tried[iframe]) { notes.push(how + ": mismo iframe ya probado"); return []; }
    tried[iframe] = true;
    log("AnimeOnline: [" + how + "] iframe → " + iframe);
    var r = fromIframe(iframe, episodeUrl, notes);
    if (r.length) log("AnimeOnline: [" + how + "] OK, " + r.length + " servidores");
    else notes.push(how + ": iframe " + shortUrl(iframe) + " sin servidores");
    return r;
  }

  var r = attempt(playerFromHtml(html), "html");
  if (r.length) return r;

  r = attempt(scanEmbed(html), "scan");
  if (r.length) return r;

  if (!opts.length) notes.push("api: la página no trae opciones dooplay_player_option");
  for (var i = 0; i < opts.length; i++) {
    var u = playerFromApi(opts[i], episodeUrl, origin, notes);
    if (!u) continue;
    r = attempt(u, "api" + opts[i].nume);
    if (r.length) return r;
    // Si la API devolvió directamente la URL de un host de vídeo (no la página agregadora), sirve como servidor.
    if (originOf(u) !== origin && !/embed\.php/i.test(u)) direct.push({ url: u, name: hostName(u), audio: "SUB", referer: episodeUrl });
  }
  if (direct.length) { log("AnimeOnline: [api] " + direct.length + " servidores directos"); return direct; }

  var msg = "No hay servidores [" + shortUrl(episodeUrl) + "] " + notes.join(" | ");
  log("AnimeOnline: " + msg);
  throw new Error(msg);
}
