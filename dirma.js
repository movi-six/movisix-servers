/*
 * Dirma — TioPlus (tioplus.app) · Películas, Series y Animes
 * Funciones que la app llama:  list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5 (var / function). Usa [\s\S] en vez de . con la bandera s.
 *
 * Portado de ServerDirma.java. Sin WebView: todo es HTTP + regex.
 * Mezcla películas y series, así que cada ítem de la lista lleva isSeries (index.json: "kind": "auto").
 */

var BASE = (CONFIG.base || "https://tioplus.app").replace(/\/+$/, "");
var TMDB_IMG = "https://image.tmdb.org/t/p/w342";

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function isSerieUrl(u) { return u.indexOf("/serie/") !== -1 || u.indexOf("/anime/") !== -1; }

// Base64 (UTF-8) — la app solo expone b64decode
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64encode(str) {
  var bin = unescape(encodeURIComponent(String(str))), out = "", i = 0;
  while (i < bin.length) {
    var a = bin.charCodeAt(i++), b = bin.charCodeAt(i++), c = bin.charCodeAt(i++);
    var hasB = !isNaN(b), hasC = !isNaN(c);
    out += B64.charAt(a >> 2);
    out += B64.charAt(((a & 3) << 4) | ((hasB ? b : 0) >> 4));
    out += hasB ? B64.charAt(((b & 15) << 2) | ((hasC ? c : 0) >> 6)) : "=";
    out += hasC ? B64.charAt(c & 63) : "=";
  }
  return out;
}

// ───────────── Tarjetas (lista y búsqueda comparten markup) ─────────────
function parseCards(html) {
  var out = [], m;
  var re = /<article class='item liste relative'>\s*<a class='itemA' href="([^"]+)">\s*<div class='item__image list'>\s*<picture>\s*<img[^>]+data-src='([^']+)'[^>]*>\s*<\/picture>\s*<span class="typeItem[^"]*">([^<]*)<\/span>\s*<\/div>\s*<h2>([^<]+)<\/h2>\s*<\/a>\s*<\/article>/g;
  while ((m = re.exec(html)) !== null) {
    var url = m[1], type = clean(m[3]), titleYear = clean(m[4]), title = titleYear, year = "";
    var ym = /\((\d{4})\)$/.exec(titleYear);
    if (ym) { year = ym[1]; title = clean(titleYear.replace("(" + year + ")", "")); }
    out.push({
      url: url,
      image: m[2],
      title: title,
      year: year,
      type: type === "Pelicúla" ? "Película" : type,
      rating: "",
      isSeries: isSerieUrl(url)
    });
  }
  return out;
}

function list(page) {
  page = page || 1;
  return parseCards(get(page <= 1 ? BASE + "/peliculas" : BASE + "/peliculas/" + page));
}

// El sitio devuelve todos los resultados de golpe (sin páginas)
function search(query, page) {
  if (page && page > 1) return [];
  return parseCards(get(BASE + "/search/" + encodeURIComponent(query)));
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = get(url), m;
  var d = {};
  var isSerie = isSerieUrl(url);

  m = /<h1 class="slugh1">([^<]+)<\/h1>/.exec(html);
  d.title = m ? clean(m[1]) : "";
  m = /<div class="description">\s*<p>([^<]+)<\/p>\s*<\/div>/.exec(html);
  if (m) d.synopsis = clean(m[1]);
  m = /<span><b>Año:<\/b> <a href="[^"]+">(\d{4})<\/a><\/span>/.exec(html);
  if (m) { d.year = m[1]; d.date = m[1]; }
  m = /<span><b>Rating:<\/b> ([^<]+)<\/span>/.exec(html);
  if (m) d.rating = clean(m[1]);
  m = /<span><b>Duración:<\/b> ([^<]+)<\/span>/.exec(html);
  if (m) d.duration = clean(m[1]);

  m = /<div class="genres">\s*<span><b>Generos<\/b><\/span>\s*([\s\S]*?)\s*<\/div>/.exec(html);
  if (m) {
    var g = [], gm, gre = /<a href="[^"]+">([^<]+)<\/a>/g;
    while ((gm = gre.exec(m[1])) !== null) g.push(clean(gm[1]));
    if (g.length) d.genres = g.join(", ");
  }

  m = /<div class='bg' style='background-image: url\("([^"]+)"\);'>/.exec(html);
  if (m) d.banner = m[1];

  if (!isSerie) {
    d.isSeries = false;
    d.episodes = [{ title: "Película Completa", url: url, image: d.poster || d.banner || "" }];
    return d;
  }

  // Serie / anime: el HTML trae  const seasonsJson = { "1": [ {title, image, season, episode}, … ], … };
  var sm = /\/(serie|anime)\/([^\/?#]+)/.exec(url);
  var type = sm ? sm[1] : "serie", slug = sm ? sm[2] : "";
  var seasons = [];
  var jm = /const seasonsJson\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
  if (jm) {
    var root = null;
    try { root = JSON.parse(jm[1]); } catch (e) { log("seasonsJson inválido: " + e); }
    if (root) {
      var nums = [], k;
      for (k in root) { var n = parseInt(k, 10); if (!isNaN(n)) nums.push(n); }
      nums.sort(function (a, b) { return a - b; });
      for (var i = 0; i < nums.length; i++) {
        var arr = root[String(nums[i])] || [], eps = [];
        for (var j = 0; j < arr.length; j++) {
          var ep = arr[j];
          var epNum = ep.episode != null ? parseInt(ep.episode, 10) : j + 1;
          var sNum = ep.season != null ? parseInt(ep.season, 10) : nums[i];
          var img = String(ep.image || "");
          if (img.indexOf("http") !== 0) img = TMDB_IMG + img;
          eps.push({
            title: clean(ep.title || ("Episodio " + epNum)),
            url: BASE + "/" + type + "/" + slug + "/season/" + sNum + "/episode/" + epNum,
            number: String(epNum),
            season: String(sNum),
            image: img
          });
        }
        eps.sort(function (a, b) { return parseInt(a.number, 10) - parseInt(b.number, 10); });
        seasons.push({ season: nums[i], title: "Temporada " + nums[i], episodes: eps });
      }
    }
  }
  d.seasons = seasons;
  d.isSeries = true;
  return d;
}

// ───────────── Reproductores ─────────────
// Cada <li data-server="…"> se abre en /player/<base64> y de ahí sale la URL real.
function realUrl(playerUrl) {
  var h;
  try { h = get(playerUrl); } catch (e) { log("player: " + e); return ""; }
  var m = /window\.location\.href\s*=\s*['"]([^'"]+)['"]/.exec(h);
  if (m) return m[1];
  m = /setTimeout[^{]*\{[^'"]*['"]([^'"]+)['"]/.exec(h);
  if (m) return m[1];
  m = /<iframe[^>]+src=['"]([^'"]+)['"][^>]*>/.exec(h);
  return m ? m[1] : "";
}

function servers(episodeUrl) {
  var html = get(episodeUrl), out = [], m;
  var re = /<li[^>]+data-server="([^"]+)"[^>]*>\s*<span>([^<]+)<\/span>/g;
  while ((m = re.exec(html)) !== null) {
    var u = realUrl(BASE + "/player/" + b64encode(m[1]));
    if (u) out.push(u);
  }
  return out;
}
