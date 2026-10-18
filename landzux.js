/*
 * Landzux — ZonaTMO (zonatmo.org) · Mangas (lector, HTTP puro)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(url) · images(chapterUrl, referer)
 * index.json: "manga": true. ES5.
 */

var BASE = (CONFIG.base || "https://zonatmo.org").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }

function get(url, referer) {
  var h = http.get(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": referer || BASE + "/",
    "Accept": "text/html,application/xhtml+xml"
  });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h.replace(/[\r\n]+/g, "");
}

function fixUrl(u) {
  if (!u) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http://") === 0) return "https://" + u.substring(7);
  return u;
}

function parseCards(html) {
  var out = [], m;
  var re = /<div\s+class="element[^"]*"\s+data-identifier="(\d+)"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>\s*<div\s+class="thumbnail\s+book[^"]*"\s+data-bg="([^"]+)"[^>]*>[\s\S]*?<h4\s+class="text-truncate"\s+title="([^"]+)"/gi;
  while ((m = re.exec(html)) !== null) {
    var url = trim(m[2]);
    if (url.charAt(0) === "/") url = BASE + url;
    out.push({ id: m[1], url: url, image: fixUrl(trim(m[3])), title: clean(m[4]) });
  }
  return out;
}

function list(page) {
  page = page || 1;
  return parseCards(get(BASE + "/biblioteca?order_item=creation&order_dir=desc&title=&_pg=1&page=" + page));
}

function search(query, page) {
  page = page || 1;
  return parseCards(get(BASE + "/biblioteca?title=" + encodeURIComponent(query) + "&_pg=1&page=" + page));
}

function detail(pageUrl) {
  var html = get(pageUrl), m, d = {};
  var title = "Sin título";
  m = /<h1\s+class="element-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (m) title = clean(m[1].replace(/<small[^>]*>[\s\S]*?<\/small>/g, ""));
  d.title = title;

  m = /<p\s+class="element-description[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = /<h5\s+class="element-subtitle"[^>]*>\s*Géneros\s*<\/h5>\s*([\s\S]*?)(?=<h5\s+class="element-subtitle"|$)/i.exec(html);
  if (m) {
    var genres = [], g, gre = /<a\s+class="badge\s+badge-primary[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/a>/gi;
    while ((g = gre.exec(m[1])) !== null) genres.push(trim(g[1]));
    if (genres.length) d.genres = genres.join(", ");
  }

  var chapters = [], c, cre = /<li[^>]*data-chapter-number="([^"]+)"[^>]*>[\s\S]*?<a[^>]*href="([^"]*view_uploads\/[^"]+)"[^>]*>[\s\S]*?Leer online[\s\S]*?<\/a>/gi;
  while ((c = cre.exec(html)) !== null) {
    var u = c[2];
    if (u.indexOf("http") !== 0) u = BASE + u;
    chapters.push({ number: c[1], title: "Capítulo " + c[1], url: u, manga_url: pageUrl, image: "" });
  }
  chapters.reverse();
  d.episodes = chapters;
  d.isSeries = chapters.length > 0;
  return d;
}

function servers(episodeUrl) { return [episodeUrl]; }

function images(chapterUrl, referer) {
  var html = get(chapterUrl, referer || chapterUrl), out = [], m;
  var re = /<div\s+class="reader-img-wrap"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/gi;
  while ((m = re.exec(html)) !== null) if (m[1].indexOf("http") === 0) out.push(m[1]);
  if (!out.length) {
    var fb = /<img[^>]*src="(https?:\/\/[^"]*storage[^"]+)"[^>]*>/gi;
    while ((m = fb.exec(html)) !== null) out.push(m[1]);
  }
  return out;
}
