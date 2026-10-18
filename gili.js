/*
 * ServerGili — Cinecalidad (cinecalidad.rs) · Películas 4K
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 */

var BASE = (CONFIG.base || "https://www.cinecalidad.rs").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function get(url, headers) {
  var h = http.get(url, headers || {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": BASE + "/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function parseCards(html) {
  var out = [], seen = {}, m;
  var re = /<div class="home_post_cont[\s\S]*?<a[^>]+href\s*=\s*"?([^"\s>]+)"?[\s\S]*?<img[^>]+src\s*=\s*"?([^"\s>]+)"?[^>]+title\s*=\s*"([^"]+)"/g;
  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]);
    if (seen[url]) continue;
    seen[url] = true;

    var rawTitle = clean(m[3]);
    var title = rawTitle, year = "";
    var ym = /^(.*)\s\((\d{4})\)$/.exec(rawTitle);
    if (ym) { title = clean(ym[1]); year = ym[2]; }

    out.push({ title: title, url: url, image: abs(m[2]), year: year, type: "movie" });
  }
  return out;
}

function list(page) {
  page = page || 1;
  var url = page === 1
    ? BASE + "/peliculas/4k-ultra-hd/"
    : BASE + "/peliculas/4k-ultra-hd/page/" + page + "/";
  return parseCards(get(url));
}

function search(query, page) {
  page = page || 1;
  var baseUrl = BASE + "/peliculas/4k-ultra-hd";
  var url = page === 1
    ? baseUrl + "/?s=" + encodeURIComponent(query)
    : baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query);
  return parseCards(get(url));
}

function detail(url) {
  var html = get(url), m;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", episodes: [] };

  m = /<h1>([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<img[^>]+class="[^"]*alignnone[^"]*"[^>]+src="([^"]+)"/.exec(html);
  if (!m) m = /<img[^>]+src="(https:\/\/[^"]+(?:jpg|jpeg|png|webp))"[^>]+class="[^"]*wp-post-image/.exec(html);
  if (m) d.poster = m[1];

  m = /<td style=text-align:justify>([\s\S]*?)<\/td>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " ")).split("\n")[0];

  m = /(\d+\.\d+)\/10/.exec(html);
  if (m) d.rating = m[1] + "/10";

  m = /<strong>Género:<\/strong>[\s\S]*?<a[^>]+>([^<]+)/.exec(html);
  if (m) d.genres = clean(m[1]);

  m = /\((\d{4})\)/.exec(html);
  if (m) d.year = m[1];

  m = /<strong>Director:<\/strong>([^<]+)/.exec(html);
  if (m) d.director = clean(m[1]);

  d.episodes.push({ title: d.title || "Ver Película", url: url, image: d.poster });
  return d;
}

function servers(episodeUrl) {
  var html = get(episodeUrl);
  var out = [];
  var re = /class="link onlinelink"[^>]+service=(\w+)\s+data=([^\s>]+)/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var svc = m[1], data = m[2], finalUrl = "";
    if (svc === "OnlineFilemoon")        finalUrl = "https://filemoon.sx/bkg/" + data;
    else if (svc === "OnlineVoe")        finalUrl = "https://voe.sx/e/" + data;
    else if (svc === "OnlineDoodstream") finalUrl = "https://doodstream.com/e/" + data;
    else if (svc === "OnlineMega")       finalUrl = "https://mega.nz/embed/" + data;
    else if (svc === "Trailer")          finalUrl = "https://www.youtube.com/embed/" + data;
    if (finalUrl) out.push(finalUrl);
  }
  return out;
}