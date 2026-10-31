/*
 * Dragon Translation — dragontranslation.org (Madara modificado) · Mangas / Manhwas
 * Funciones: list(page) · search(query, page) · detail(url) · images(chapterUrl, referer)
 * ES5. Sin DOM: regex sobre el HTML.
 *
 * Las clases CSS del sitio están ofuscadas (mb799cfc, m9b2e013...) y pueden cambiar, así que se
 * evitan: se usan id/clases "semánticas" (agrid, ac-rate, ac-status, ac-ch, wp-manga-chapter-img),
 * atributos (href, title, src) y la estructura.
 */

var BASE = (CONFIG.base || "https://dragontranslation.org").replace(/\/+$/, "");

function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) { return util.htmlDecode(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }

function abs(u) {
  u = str(u).replace(/^\s+|\s+$/g, "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function attr(tag, name) {
  var m = new RegExp("(?:^|[\\s\"'])" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i").exec(tag || "");
  return m ? m[2] : "";
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

// Contenido interno del <div> que abre `startRe` (cuenta divs anidados).
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

// ───────────── Rejilla (home y búsqueda comparten el mismo markup) ─────────────
// <div class="agrid" id="mkAgrid"> <a href=".../manga/slug/" title="..."> ... <img src> ... </a> ...
function parseGrid(html) {
  var area = sliceDiv(html, /<div[^>]*\bid=["']mkAgrid["'][^>]*>/i) ||
             sliceDiv(html, /<div[^>]*\bclass=["'][^"']*\bagrid\b[^"']*["'][^>]*>/i);
  if (!area) return null;
  var parts = area.split(/<a\b(?=[^>]*href=["'][^"']*\/manga\/[^"']+)/i), out = [], seen = {};
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i];
    var end = c.indexOf("</a>");
    if (end !== -1) c = c.substring(0, end);
    var open = /^([^>]*)>/.exec(c);
    var tag = open ? open[1] : "";
    var url = abs(attr(tag, "href"));
    if (!url || seen[url]) continue;
    seen[url] = true;

    var im = /<img\b[^>]*>/i.exec(c);
    var img = im ? (attr(im[0], "data-src") || attr(im[0], "data-lazy-src") || attr(im[0], "src")) : "";
    var title = attr(tag, "title") || (im ? attr(im[0], "alt") : "");
    var r = /class=["']ac-rate["'][^>]*>[\s\S]*?<\/svg>\s*([0-9]+(?:[.,][0-9]+)?)/i.exec(c);
    out.push({
      title: clean(title),
      url: url,
      image: abs(img),
      rating: r ? r[1].replace(",", ".") : "",
      year: ""
    });
  }
  return out;
}

// ───────────── Lista ─────────────
function list(page) {
  page = page || 1;
  var url = BASE + "/manga/" + (page > 1 ? "page/" + page + "/" : "");
  var cards = parseGrid(getHtml(url, BASE + "/"));
  if (!cards) { log("Dragon: no se encontró la rejilla (#mkAgrid) en " + url); return []; }
  return cards;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  var url = BASE + "/" + (page > 1 ? "page/" + page + "/" : "") + "?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
  var cards = parseGrid(getHtml(url, BASE + "/"));
  return cards || [];
}

// ───────────── Detalle ─────────────
function chaptersFromJson(html) {
  var re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].indexOf('"mangaId"') === -1) continue;
    try {
      var j = JSON.parse(m[1]);
      if (j && j.items && j.items.length) return j.items;
    } catch (e) { log("Dragon: JSON de capítulos inválido: " + e); }
  }
  return null;
}

function detail(url) {
  var html = getHtml(url, BASE + "/"), m;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: true, episodes: [] };

  m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<div[^>]*\bhero__bg\b[^>]*background-image:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(html);
  if (m) d.banner = abs(m[1]);
  m = /<img\b[^>]*\bwp-post-image\b[^>]*>/i.exec(html);
  if (m) d.poster = abs(attr(m[0], "src"));
  if (!d.poster) d.poster = d.banner;

  // Sinopsis: el <div> justo antes del botón "Leer más"
  var rm = html.indexOf('class="readmore"');
  if (rm !== -1) {
    var before = html.substring(0, rm), st = before.lastIndexOf("<div");
    if (st !== -1) d.synopsis = clean(before.substring(st));
  }

  // Géneros: solo los del hero (entre "Géneros" y los botones de acción)
  var g0 = html.indexOf("hchips-label");
  if (g0 !== -1) {
    var g1 = html.indexOf('class="hact"', g0);
    var seg = html.substring(g0, g1 === -1 ? g0 + 4000 : g1);
    var gs = [], re = /<a\b[^>]*href=["'][^"']*\/manga-genre\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, x;
    while ((x = re.exec(seg)) !== null) { var t = clean(x[1]); if (t && gs.indexOf(t) === -1) gs.push(t); }
    d.genres = gs.join(", ");
  }

  m = /hi--rating[\s\S]*?<\/svg>\s*([0-9]+(?:[.,][0-9]+)?)/i.exec(html);
  if (m) d.rating = m[1].replace(",", ".");

  // Capítulos: JSON embebido (todos, el sitio solo pagina en pantalla). Orden ascendente.
  var items = chaptersFromJson(html), eps = [];
  if (items) {
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      if (!it.url) continue;
      if (it.lk && str(it.lk) !== "0") continue;     // capítulo bloqueado
      eps.push({ title: clean(it.name || ("Capitulo " + it.num)), url: abs(it.url), image: "" });
    }
  } else {
    // Plan B: enlaces .../manga/<slug>/capitulo-N/ de la página
    var slug = (/\/manga\/([^\/]+)\/?/.exec(url) || [])[1] || "", seen = {};
    var lre = /href=["']([^"']*\/manga\/[^"'\/]+\/capitulo-[^"']+?)\/?["']/gi, l;
    while ((l = lre.exec(html)) !== null) {
      var cu = abs(l[1]) + "/";
      if (seen[cu] || cu.indexOf("/manga/" + slug + "/") === -1) continue;
      seen[cu] = true;
      eps.push({ title: clean((/capitulo-([^\/]+)/.exec(cu) || [])[0] || "Capitulo").replace(/-/g, " "), url: cu, image: "" });
    }
    eps.reverse();
    log("Dragon: sin JSON de capítulos, plan B → " + eps.length);
  }
  d.episodes = eps;
  return d;
}

// ───────────── Lector ─────────────
// Devuelve las URLs de las páginas del capítulo, en orden.
function images(chapterUrl, referer) {
  var html = getHtml(chapterUrl, BASE + "/");
  var area = html, i0 = html.indexOf("reading-content");
  if (i0 !== -1) area = html.substring(i0);

  var tags = area.match(/<img\b[^>]*>/gi) || [], out = [], seen = {}, k;
  for (k = 0; k < tags.length; k++) {
    if (!/wp-manga-chapter-img/i.test(attr(tags[k], "class"))) continue;
    var src = attr(tags[k], "data-src") || attr(tags[k], "data-lazy-src") || attr(tags[k], "data-original") || attr(tags[k], "src");
    src = abs(src);
    if (src && !seen[src]) { seen[src] = true; out.push(src); }
  }
  if (!out.length) {   // plan B: cualquier imagen de la carpeta de datos de WP-manga
    for (k = 0; k < tags.length; k++) {
      var s2 = abs(attr(tags[k], "data-src") || attr(tags[k], "src"));
      if (s2 && /\/WP-manga\/data\//i.test(s2) && !seen[s2]) { seen[s2] = true; out.push(s2); }
    }
  }
  if (!out.length) log("Dragon: capítulo sin imágenes en " + chapterUrl);
  return out;
}
