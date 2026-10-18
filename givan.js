/*
 * Givan — DORAMASLATINOX (doramaslatinox.com) · WordPress + tema DooPlay
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Los reproductores salen de la API /wp-json/dooplayer/v2/{post}/{type}/{nume}.
 * ES5.
 */

var BASE = (CONFIG.base || "https://doramaslatinox.com").replace(/\/+$/, "");
var PLAYER_API = BASE + "/wp-json/dooplayer/v2/";

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

// El sitio se leía sin saltos de línea; se conserva para que los patrones den igual.
function get(url, headers) {
  var h = http.get(url, headers || {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9"
  });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h.replace(/\r?\n/g, "");
}

function first(text, re) {
  if (!text) return null;
  var m = re.exec(text);
  return m ? m[1] : null;
}

function isFlag(url) {
  if (!url) return true;
  var l = url.toLowerCase();
  return l.indexOf("/flags/") !== -1
      || /\/mx\.png$/.test(l) || /\/es\.png$/.test(l) || /\/us\.png$/.test(l)
      || l.indexOf("wp-content/uploads/2024/05/mx.png") !== -1
      || l.indexOf("wp-content/uploads/2024/05/es.png") !== -1
      || l.indexOf("picsart_23-12-19_21-40") !== -1
      || l.indexOf("picsart_23-12-19_20-31") !== -1
      || l.indexOf("picsart_24-05-09_14-55") !== -1;
}

function pickImage(block) {
  var image = null;
  var tb = /<div class="thumbnail[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
  if (tb) image = first(tb[1], /<img[^>]*src="([^"]+)"/);
  if (!image || isFlag(image)) {
    var m, re = /<img[^>]*src="([^"]+)"/g;
    while ((m = re.exec(block)) !== null) {
      if (!isFlag(m[1])) { image = m[1]; break; }
    }
  }
  return image || "";
}

function kindOf(url) { return url.indexOf("/peliculas/") !== -1 ? "movie" : "serie"; }

// ───────────── Lista ─────────────
function list(page) {
  page = page || 1;
  var url;
  if (page === 1) url = BASE + "/tipo/dorama/";
  else if (page === 2) url = BASE + "/tipo/serie/";
  else url = BASE + "/tipo/dorama/page/" + (page - 2) + "/";
  return parseModuleItems(get(url));
}

function parseModuleItems(html) {
  var items = [], m, re = /<article[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  while ((m = re.exec(html)) !== null) {
    var block = m[1];
    var url = first(block, /<div class="thumbnail[^"]*"[^>]*>\s*<a\s+href="([^"]+)"/);
    if (url === null) url = first(block, /<h3>\s*<a\s+href="([^"]+)"/);
    if (url === null) continue;
    var title = first(block, /<h3>\s*<a[^>]*>([^<]+)<\/a>/);
    if (title === null) title = first(block, /<div class="thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]*alt="([^"]+)"/);
    if (title === null) continue;
    items.push({
      url: url,
      image: pickImage(block),
      title: clean(title),
      year: first(block, /<span class="year">(\d{4})<\/span>/) || "",
      kind: kindOf(url)
    });
  }
  if (!items.length) items = parseSearchResults(html);
  return items;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  var q = encodeURIComponent(query);
  var url = (!page || page <= 1) ? BASE + "/?s=" + q : BASE + "/page/" + page + "/?s=" + q;
  return parseSearchResults(get(url));
}

function parseSearchResults(html) {
  var results = [], bm, re = /<div class="result-item">([\s\S]*?)<\/article>\s*<\/div>/g;
  while ((bm = re.exec(html)) !== null) {
    var block = bm[1];

    // Fuera los episodios sueltos
    if (block.indexOf('class="episodes"') !== -1 || block.indexOf(">Epidosio<") !== -1 ||
        block.indexOf(">Episodio<") !== -1 || block.indexOf(">EPISODIO<") !== -1 ||
        block.indexOf(">Episodios<") !== -1) continue;
    var rawHref = first(block, /<a href="([^"]+)"/);
    if (rawHref && rawHref.indexOf("/episodio/") !== -1) continue;

    var url = first(block, /<div class="thumbnail[^"]*"[^>]*>\s*<a\s+href="([^"]+)"/);
    if (url === null) url = first(block, /<div class="title">\s*<a href="([^"]+)"/);
    if (url === null) url = first(block, /<a href="([^"]+)"/);
    if (url === null) continue;

    var title = first(block, /<div class="title">\s*<a[^>]*>([^<]+)<\/a>/);
    if (title === null) title = first(block, /<div class="thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]*alt="([^"]+)"/);
    if (title === null) continue;

    var dt = /<span class="(?:tvshows|movies)">([^<]+)<\/span>/.exec(block);
    results.push({
      url: url,
      image: pickImage(block),
      title: clean(title),
      year: first(block, /<span class="year">(\d{4})<\/span>/) || "",
      type: dt ? dt[1] : "",
      kind: kindOf(url)
    });
  }
  return results;
}

// ───────────── Detalle + episodios ─────────────
function epNum(title) {
  if (!title) return -1;
  var m = /(\d+)\s*-\s*(\d+)/.exec(title);
  if (m) return parseInt(m[2], 10);
  m = /(\d+)x(\d+)/.exec(title);
  if (m) return parseInt(m[2], 10);
  var last = -1, re = /(\d+)/g;
  while ((m = re.exec(title)) !== null) last = parseInt(m[1], 10);
  return last;
}

function detail(detailUrl) {
  var html = get(detailUrl), d = {}, m;

  // Página de episodio: hereda sinopsis/géneros/poster/año/temporadas de la serie padre
  if (detailUrl.indexOf("/episodio/") !== -1) {
    var sm = /\/episodio\/([a-z0-9\-]+?)-\d+x\d+/.exec(detailUrl);
    if (sm) {
      try {
        var series = detail(BASE + "/series/" + sm[1] + "/");
        var keys = ["synopsis", "genres", "poster", "banner", "year", "seasons", "isSeries"];
        for (var k = 0; k < keys.length; k++) if (series[keys[k]] !== undefined) d[keys[k]] = series[keys[k]];
      } catch (e) { log("serie padre: " + e); }
    }
    m = /<h1>([^<]+)<\/h1>/.exec(html);
    if (m) d.title = clean(m[1]);
    if (d.poster === undefined) {
      m = /#dt_contenedor\{background-image:url\(([^)]+)\)/.exec(html);
      if (m) d.poster = m[1].replace(/"/g, "").replace(/^\s+|\s+$/g, "");
    }
    return d;
  }

  m = /<div class="sheader">[\s\S]*?<div class="data">\s*<h1>([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);
  m = /<div class="poster">\s*<img[^>]*src="([^"]+)"/.exec(html);
  if (m) d.poster = m[1];
  m = /#dt_contenedor\{background-image:url\(([^)]+)\)/.exec(html);
  if (m) d.banner = m[1].replace(/"/g, "").replace(/^\s+|\s+$/g, "");
  m = /<div id="info"[^>]*>[\s\S]*?<p>([^<]+)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = /<b>Año:\s*<\/b>\s*<a[^>]*>(\d{4})<\/a>/.exec(html);
  if (m) d.year = m[1];
  else {
    m = /<div class="extra">\s*<span>(\d{4})\s*<\/span>/.exec(html);
    if (m) d.year = m[1];
  }

  m = /<div class="sgeneros">([\s\S]*?)<\/div>/.exec(html);
  if (m) {
    var genres = [], g, gre = /<a[^>]*>([^<]+)<\/a>/g;
    while ((g = gre.exec(m[1])) !== null) genres.push(g[1].replace(/^\s+|\s+$/g, ""));
    d.genres = genres.join(", ");
  }

  // Episodios
  var episodes = [], eb, ebre = /<ul class="episodios">([\s\S]*?)<\/ul>/g;
  while ((eb = ebre.exec(html)) !== null) {
    var em, ere = /<a href="([^"]+)">\s*<li class="mark-(\d+)">\s*<div class="imagen">\s*<img src="([^"]+)">\s*<\/div>\s*<div class="numerando">([^<]+)<\/div>\s*<div class="episodiotitle">([^<]+)<span/g;
    while ((em = ere.exec(eb[1])) !== null) {
      episodes.push({
        url: em[1],
        image: em[3],
        number: em[4].replace(/^\s+|\s+$/g, ""),
        title: clean(em[5]),
        _i: episodes.length
      });
    }
  }
  episodes.sort(function (a, b) { return (epNum(a.number) - epNum(b.number)) || (a._i - b._i); });
  for (var i = 0; i < episodes.length; i++) delete episodes[i]._i;

  if (episodes.length) {
    episodes.reverse();   // la app los muestra del más nuevo al más viejo
    d.isSeries = true;
    d.seasons = [{ season: 1, episodes: episodes }];
  } else {
    d.isSeries = false;
    d.episodes = [{ title: d.title || "Ver", url: detailUrl, image: d.poster || "" }];
  }

  // Relacionados (en orden aleatorio)
  var related = [];
  var rb = /<div id="single_relacionados">([\s\S]*?)<\/div>/.exec(html);
  if (rb) {
    var rm, rre = /<article>\s*<a href="([^"]+)">\s*<img src="([^"]+)"\s+alt="([^"]+)"/g;
    while ((rm = rre.exec(rb[1])) !== null) related.push({ url: rm[1], image: rm[2], title: clean(rm[3]) });
  }
  for (var j = related.length - 1; j > 0; j--) {
    var r = Math.floor(Math.random() * (j + 1)), t = related[j];
    related[j] = related[r]; related[r] = t;
  }
  d.relatedContent = related;
  return d;
}

// ───────────── Reproductores ─────────────
function servers(episodeUrl) {
  var html = get(episodeUrl);
  var opts = [], m;

  var re = /<li[^>]*class=["']dooplay_player_option["'][^>]*data-type=["']([^"']*)["'][^>]*data-post=["'](\d+)["'][^>]*data-nume=["'](\d+)["']/g;
  while ((m = re.exec(html)) !== null) opts.push({ type: m[1], post: m[2], nume: m[3] });

  if (!opts.length) {   // por si cambia el orden de atributos
    var fm, fre = /<li[^>]*dooplay_player_option[^>]*>([\s\S]*?)<\/li>/g;
    while ((fm = fre.exec(html)) !== null) {
      var block = fm[0];
      var post = first(block, /data-post=["'](\d+)["']/);
      var nume = first(block, /data-nume=["'](\d+)["']/);
      if (post !== null && nume !== null) opts.push({ type: first(block, /data-type=["']([^"']*)["']/) || "tv", post: post, nume: nume });
    }
  }

  var out = [], seen = {};
  for (var i = 0; i < opts.length; i++) {
    try {
      var json = http.get(PLAYER_API + opts[i].post + "/" + opts[i].type + "/" + opts[i].nume, {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": BASE + "/"
      });
      var em = /"embed_url"\s*:\s*"([^"]+)"/.exec(json || "");
      if (em) {
        var embed = em[1].replace(/\\\//g, "/");
        if (embed && !seen[embed]) { seen[embed] = true; out.push(embed); }
      }
    } catch (e) { log("embed: " + e); }
  }
  return out;
}
