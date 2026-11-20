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
// Estrategias para hallar el iframe del player (se prueban en orden hasta que una dé servidores):
//   html    → <iframe class="metaframe" src=...> en el HTML normal de la página del episodio
//   ajax    → API de DooPlay (admin-ajax)
//   postid  → https://<CONFIG.embed o saidochesto.top>/embed.php?id=<id del post>
//   webview → web.html(episodio): HTML ya renderizado con JS, solo para sacar la URL del iframe
// Luego el iframe se pide por HTTP (la app inyecta la cookie de Cloudflare de ese host)
// y se leen los go_to_player('url') de cada <div class="OD OD_xxx">.

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

// src real de un <iframe>: ignora about:blank / data: (lazy-load) y prueba los data-*.
function iframeSrc(tag) {
  var c = [attr(tag, "src"), attr(tag, "data-src"), attr(tag, "data-lazy-src"), attr(tag, "data-litespeed-src")];
  for (var i = 0; i < c.length; i++) {
    var s = str(c[i]).replace(/^\s+|\s+$/g, "");
    if (!s || /^(about:|data:|javascript:)/i.test(s)) continue;
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

function playerFromAjax(html, episodeUrl) {
  var o = /<li[^>]*dooplay_player_option[^>]*>/i.exec(html);
  if (!o) return "";
  var post = attr(o[0], "data-post"), nume = attr(o[0], "data-nume"), type = attr(o[0], "data-type") || "tv";
  if (!post || !nume) return "";
  try {
    var r = http.post(BASE + "/wp-admin/admin-ajax.php",
      "action=doo_player_ajax&post=" + encodeURIComponent(post) + "&nume=" + encodeURIComponent(nume) + "&type=" + encodeURIComponent(type),
      { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", "Referer": episodeUrl, "Origin": BASE });
    var j = JSON.parse(r || "{}");
    var e = j.embed_url || "";
    var mm = /src=["']([^"']+)["']/i.exec(e);
    if (mm) return abs(util.htmlDecode(mm[1]));
    if (/^https?:/i.test(e)) return e;
  } catch (err) {
    if (isCf(err)) throw err;
    log("AnimeOnline ajax error: " + err);
  }
  return "";
}

// ID del post de WordPress (suele coincidir con el ?id= del embed.php)
function postIdOf(html) {
  var m = /data-post=["'](\d+)["']/i.exec(html) ||
          /\bpostid-(\d+)/i.exec(html) ||
          /rel=["']shortlink["'][^>]*href=["'][^"']*[?&]p=(\d+)/i.exec(html);
  return m ? m[1] : "";
}

// HTML renderizado con WebView (solo para localizar el iframe cuando no viene en el HTML plano).
function renderedHtml(url) {
  try {
    if (typeof web === "undefined" || !web || !web.html) return "";
    return str(web.html(url));
  } catch (e) {
    if (isCf(e)) throw e;
    log("AnimeOnline: web.html falló: " + e);
    return "";
  }
}

function hostName(u) {
  var m = /^https?:\/\/(?:www\.)?([^\/:?#]+)/i.exec(str(u));
  return m ? cap(m[1].split(".")[0]) : "Servidor";
}

// Pide el iframe por HTTP y extrae los servidores por idioma.
function fromIframe(iframe, episodeUrl) {
  var ih = "";
  try { ih = getHtml(iframe, episodeUrl); } catch (e1) { if (isCf(e1)) throw e1; log("AnimeOnline: iframe (referer episodio) falló: " + e1); }
  if (!ih || ih.indexOf("go_to_player") === -1) {
    try { ih = getHtml(iframe, BASE + "/"); } catch (e2) { if (isCf(e2)) throw e2; log("AnimeOnline: iframe (referer base) falló: " + e2); }
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

  if (out.length === 0) log("AnimeOnline: el iframe no trae servidores. Inicio: " + str(ih).substring(0, 300).replace(/\s+/g, " "));
  return out;
}

function servers(episodeUrl) {
  var html = getHtml(episodeUrl, BASE + "/");
  var tried = {};
  function attempt(iframe, how) {
    if (!iframe || tried[iframe]) return [];
    tried[iframe] = true;
    log("AnimeOnline: [" + how + "] iframe → " + iframe);
    return fromIframe(iframe, episodeUrl);
  }

  var r = attempt(playerFromHtml(html), "html");
  if (r.length) return r;

  r = attempt(playerFromAjax(html, episodeUrl), "ajax");
  if (r.length) return r;

  var pid = postIdOf(html);
  if (pid) {
    var embed = str(CONFIG.embed || "https://saidochesto.top").replace(/\/+$/, "");
    r = attempt(embed + "/embed.php?id=" + pid, "postid");
    if (r.length) return r;
  }

  var rh = renderedHtml(episodeUrl);
  if (rh) {
    r = attempt(playerFromHtml(rh), "webview");
    if (r.length) return r;
  }

  log("AnimeOnline: sin servidores en " + episodeUrl + " | iframes en HTML: " +
      (str(html).match(/<iframe\b[^>]*>/gi) || []).join(" ").substring(0, 300) + " | postId: " + pid);
  return [];
}
