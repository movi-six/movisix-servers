/*
 * Dirma — TioPlus (tioplus.app) · películas, series y animes
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5. Los reproductores salen de /player/<base64 del data-server>.
 */

var BASE = (CONFIG.base || "https://tioplus.app").replace(/\/+$/, "");
var TMDB_IMG = "https://image.tmdb.org/t/p/w342";

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }

// El sitio original se leía sin saltos de línea: se conserva para que los patrones den igual.
function get(url) {
  var h = http.get(url, { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8" });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h.replace(/\r?\n/g, "");
}

function abs(u) {
  u = String(u || "");
  return u.charAt(0) === "/" ? BASE + u : u;
}

function kindOf(url) { return (url.indexOf("/serie/") !== -1 || url.indexOf("/anime/") !== -1) ? "serie" : "movie"; }

function cardRe() {
  return /<article class='item liste relative'>\s*<a class='itemA' href="([^"]+)">\s*<div class='item__image list'>\s*<picture>\s*<img[^>]+data-src='([^']+)'[^>]*>\s*<\/picture>\s*<span class="typeItem[^"]*">([^<]*)<\/span>\s*<\/div>\s*<h2>([^<]+)<\/h2>\s*<\/a>\s*<\/article>/g;
}

function parseCards(html) {
  var out = [], m, re = cardRe();
  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]);
    var type = trim(m[3]);
    var titleYear = trim(m[4]);
    var title = titleYear, year = "";
    var ym = /\((\d{4})\)$/.exec(titleYear);
    if (ym) { year = ym[1]; title = trim(titleYear.replace("(" + year + ")", "")); }
    out.push({
      url: url,
      image: m[2],
      title: clean(title),
      year: year,
      type: type === "Pelicúla" ? "Película" : type,
      rating: "",
      kind: kindOf(url)
    });
  }
  return out;
}

// ───────────── Lista (películas) y búsqueda ─────────────
function list(page) {
  page = page || 1;
  return parseCards(get(page === 1 ? BASE + "/peliculas" : BASE + "/peliculas/" + page));
}

function search(query, page) {
  if (page && page > 1) return [];   // el sitio devuelve todo de una vez
  return parseCards(get(BASE + "/search/" + encodeURIComponent(query)));
}

// ───────────── Detalle ─────────────
function detail(pageUrl) {
  var html = get(pageUrl);
  var d = {}, m;
  var isSerie = pageUrl.indexOf("/serie/") !== -1 || pageUrl.indexOf("/anime/") !== -1;

  m = /<h1 class="slugh1">([^<]+)<\/h1>/.exec(html);
  d.title = m ? clean(m[1]) : "";
  m = /<div class="description">\s*<p>([^<]+)<\/p>\s*<\/div>/.exec(html);
  if (m) d.synopsis = clean(m[1]);
  m = /<span><b>Año:<\/b> <a href="[^"]+">(\d{4})<\/a><\/span>/.exec(html);
  if (m) { d.year = m[1]; d.date = m[1]; }
  m = /<span><b>Rating:<\/b> ([^<]+)<\/span>/.exec(html);
  if (m) d.rating = trim(m[1]);
  m = /<span><b>Duración:<\/b> ([^<]+)<\/span>/.exec(html);
  if (m) d.duration = trim(m[1]);

  m = /<div class="genres">\s*<span><b>Generos<\/b><\/span>\s*([\s\S]*?)\s*<\/div>/.exec(html);
  if (m) {
    var genres = [], g, gre = /<a href="[^"]+">([^<]+)<\/a>/g;
    while ((g = gre.exec(m[1])) !== null) genres.push(trim(g[1]));
    d.genres = genres.join(", ");
  }
  m = /<div class='bg' style='background-image: url\("([^"]+)"\);'>/.exec(html);
  if (m) d.banner = m[1];

  if (isSerie) {
    var sm = /\/(serie|anime)\/([^\/?#]+)/.exec(pageUrl);
    var slug = sm ? sm[2] : "";
    var type = pageUrl.indexOf("/anime/") !== -1 ? "anime" : "serie";
    var seasons = parseSeasonsJson(html, type, slug);
    d.seasons = seasons;
    d.isSeries = true;
    var all = [];
    for (var i = 0; i < seasons.length; i++) all = all.concat(seasons[i].episodes);
    d.episodes = all;
  } else {
    d.episodes = [{ url: pageUrl, title: "Película Completa" }];
    d.isSeries = false;
  }
  return d;
}

// El HTML trae:  const seasonsJson = { "1": [ {title, image, season, episode}, ... ], "2": [...] };
function parseSeasonsJson(html, type, slug) {
  var seasons = [];
  var jm = /const seasonsJson\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
  if (!jm) return seasons;
  var root;
  try { root = JSON.parse(jm[1]); } catch (e) { return seasons; }

  var nums = [], k;
  for (k in root) {
    if (Object.prototype.hasOwnProperty.call(root, k) && /^\d+$/.test(k)) nums.push(parseInt(k, 10));
  }
  nums.sort(function (a, b) { return a - b; });

  for (var s = 0; s < nums.length; s++) {
    var seasonNum = nums[s];
    var eps = root[String(seasonNum)] || [];
    var list = [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      var epNum = (ep.episode !== undefined && ep.episode !== null && !isNaN(parseInt(ep.episode, 10))) ? parseInt(ep.episode, 10) : i + 1;
      var sNum = (ep.season !== undefined && ep.season !== null && !isNaN(parseInt(ep.season, 10))) ? parseInt(ep.season, 10) : seasonNum;
      var title = (ep.title !== undefined && ep.title !== null) ? String(ep.title) : "Episodio " + epNum;
      var img = String(ep.image || "");
      list.push({
        url: BASE + "/" + type + "/" + slug + "/season/" + sNum + "/episode/" + epNum,
        title: clean(title),
        number: String(epNum),
        season: String(sNum),
        image: img ? (img.indexOf("http") === 0 ? img : TMDB_IMG + img) : "",
        _i: i
      });
    }
    list.sort(function (a, b) { return (parseInt(a.number, 10) - parseInt(b.number, 10)) || (a._i - b._i); });
    for (var j = 0; j < list.length; j++) delete list[j]._i;
    seasons.push({ season: seasonNum, episodes: list, episodeCount: list.length });
  }
  return seasons;
}

// ───────────── Reproductores ─────────────
function servers(pageUrl) {
  var html = get(pageUrl), out = [], m;
  var re = /<li[^>]+data-server="([^"]+)"[^>]*>\s*<span>([^<]+)<\/span>/g;
  while ((m = re.exec(html)) !== null) {
    var realUrl = fromPlayer(BASE + "/player/" + util.b64encode(m[1]));
    if (realUrl) out.push(realUrl);
  }
  return out;
}

function fromPlayer(playerUrl) {
  try {
    var h = get(playerUrl), m;
    m = /window\.location\.href\s*=\s*['"]([^'"]+)['"]/.exec(h);
    if (m) return m[1];
    m = /setTimeout[^{]*\{[^'"]*['"]([^'"]+)['"]/.exec(h);
    if (m) return m[1];
    m = /<iframe[^>]+src=['"]([^'"]+)['"][^>]*>/.exec(h);
    if (m) return m[1];
  } catch (e) { log("player: " + e); }
  return null;
}
