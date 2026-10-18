/*
 * Kuro — 3Hentai (es.3hentai.net) · H-Mangas (lector, HTTP puro)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(url) · images(chapterUrl, referer)
 * index.json: "manga": true. ES5.
 */

var BASE = (CONFIG.base || "https://es.3hentai.net").replace(/\/+$/, "");
var ORIGIN = BASE.replace(/^(https?:\/\/[^\/]+).*$/, "$1");
var HOST_RE = ORIGIN.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }

function get(url) {
  var h = http.get(url, { "User-Agent": "Mozilla/5.0" });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h.replace(/[\r\n]+/g, "");
}

function parseList(html) {
  var out = [], m;
  var re = new RegExp("<div class=\"doujin-col\">[\\s\\S]*?<a href=\"(" + HOST_RE + "\\/d\\/\\d+)\"[\\s\\S]*?data-src=\"([^\"]+)\"[\\s\\S]*?<div class=\"title[^\"]*\">([^<]+)", "g");
  while ((m = re.exec(html)) !== null) out.push({ url: trim(m[1]), image: m[2], title: clean(m[3]) });
  return out;
}

function list(page) {
  page = page || 1;
  return parseList(get(page === 1 ? BASE + "/language/spanish" : BASE + "/language/spanish/" + page));
}

function search(query, page) {
  page = page || 1;
  return parseList(get(BASE + "/search?q=" + encodeURIComponent(query) + "&page=" + page));
}

function links(block, sep, stripParens) {
  var out = [], m, re = /<a[^>]*>([\s\S]+?)<\/a>/g;
  while ((m = re.exec(block)) !== null) {
    var t = clean(m[1]);
    if (stripParens) t = trim(t.replace(/\([\s\S]*?\)/g, ""));
    if (t) out.push(t);
  }
  return out.join(sep);
}

function field(html, label) {
  var m = new RegExp("<div class=\"tag-container field-name\">\\s*" + label + ":\\s*([\\s\\S]*?)<\\/div>").exec(html);
  return m ? m[1] : null;
}

function detail(pageUrl) {
  var html = get(pageUrl), d = {}, b, s;
  var tm = /<h1 class="text-left[^"]*">\s*([\s\S]*?)<\/h1>/.exec(html);
  if (tm) d.title = clean(tm[1]);
  if ((b = field(html, "Artistas")) !== null && (s = links(b, " | ", false))) d.subtitle = s;
  if ((b = field(html, "Grupos")) !== null && (s = links(b, ", ", false))) d.synopsis = s;
  if ((b = field(html, "Etiquetas")) !== null && (s = links(b, ", ", true))) d.genres = s;
  d.episodes = [{ title: "Capítulo 1", url: pageUrl, image: "", manga_url: pageUrl }];
  d.isSeries = false;
  return d;
}

// Es un lector: no hay reproductores, se devuelve la propia URL
function servers(episodeUrl) { return [episodeUrl]; }

function images(pageUrl, referer) {
  var html = get(pageUrl), out = [], m;
  var re = /<div class="single-thumb">[\s\S]*?data-src="([^"]+)"/g;
  while ((m = re.exec(html)) !== null) {
    var u = m[1];
    if (u.indexOf("t.jpg") >= 0) u = u.split("t.jpg").join(".jpg");
    out.push(u);
  }
  return out;
}
