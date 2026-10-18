/*
 * Givan — DoramasLatinox (doramaslatinox.com) · Doramas y películas
 * Funciones que la app llama:  list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5 (var / function). Usa [\s\S] en vez de . con la bandera s.
 *
 * Portado de ServerGivan.java. Sin WebView: WordPress + tema DooPlay, todo HTTP + regex.
 * Mezcla series y películas, así que cada ítem de la lista lleva isSeries (index.json: "kind": "auto").
 *
 *   Listados   /tipo/dorama/  /tipo/serie/  /page/N/        Búsqueda  /?s=query  ·  /page/N/?s=query
 *   Detalle    /series/slug/  /peliculas/slug/              Episodio  /episodio/slug-1x1-titulo/
 *   Servidores: no están en el HTML del episodio, salen de la API  GET /wp-json/dooplayer/v2/{post}/{type}/{nume}
 */

var BASE = (CONFIG.base || "https://doramaslatinox.com").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

// Primer grupo de una regex, o null
function fm(text, re) {
  var m = re.exec(text || "");
  return m ? m[1] : null;
}

function isFlag(u) {
  if (!u) return true;
  var l = String(u).toLowerCase();
  return l.indexOf("/flags/") !== -1 || /\/(mx|es|us)\.png$/.test(l)
      || l.indexOf("wp-content/uploads/2024/05/mx.png") !== -1
      || l.indexOf("wp-content/uploads/2024/05/es.png") !== -1
      || l.indexOf("picsart_23-12-19_21-40") !== -1
      || l.indexOf("picsart_23-12-19_20-31") !== -1
      || l.indexOf("picsart_24-05-09_14-55") !== -1;
}

// Primera imagen que no sea una bandera de idioma
function pickImage(block) {
  var image = null, t = /<div class="thumbnail[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
  if (t) image = fm(t[1], /<img[^>]*src="([^"]+)"/);
  if (!image || isFlag(image)) {
    var re = /<img[^>]*src="([^"]+)"/g, m;
    while ((m = re.exec(block)) !== null) { if (!isFlag(m[1])) { image = m[1]; break; } }
  }
  return image || "";
}

function typeOf(url) { return url.indexOf("/peliculas/") === -1; }   // true = serie (todo lo que no sea /peliculas/)

// ───────────── Lista principal ─────────────
function parseModuleItems(html) {
  var items = [], m;
  var re = /<article[^>]*class="[^"]*item[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  while ((m = re.exec(html)) !== null) {
    var block = m[1];
    var url = fm(block, /<div class="thumbnail[^"]*"[^>]*>\s*<a\s+href="([^"]+)"/) || fm(block, /<h3>\s*<a\s+href="([^"]+)"/);
    if (!url) continue;
    var title = fm(block, /<h3>\s*<a[^>]*>([^<]+)<\/a>/) || fm(block, /<div class="thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]*alt="([^"]+)"/);
    if (!title) continue;
    items.push({
      url: url,
      image: pickImage(block),
      title: clean(title),
      year: fm(block, /<span class="year">(\d{4})<\/span>/) || "",
      isSeries: typeOf(url)
    });
  }
  if (!items.length) return parseSearchResults(html);
  return items;
}

function list(page) {
  page = page || 1;
  var url;
  if (page === 1) url = BASE + "/tipo/dorama/";
  else if (page === 2) url = BASE + "/tipo/serie/";
  else url = BASE + "/tipo/dorama/page/" + (page - 2) + "/";
  return parseModuleItems(get(url));
}

// ───────────── Búsqueda ─────────────
function parseSearchResults(html) {
  var out = [], m;
  var re = /<div class="result-item">([\s\S]*?)<\/article>\s*<\/div>/g;
  while ((m = re.exec(html)) !== null) {
    var block = m[1];

    // Descarta episodios sueltos (badge o URL)
    if (/class="episodes"|>Epidosio<|>Episodio<|>EPISODIO<|>Episodios</.test(block)) continue;
    var rawHref = fm(block, /<a href="([^"]+)"/);
    if (rawHref && rawHref.indexOf("/episodio/") !== -1) continue;

    var url = fm(block, /<div class="thumbnail[^"]*"[^>]*>\s*<a\s+href="([^"]+)"/)
           || fm(block, /<div class="title">\s*<a href="([^"]+)"/) || rawHref;
    if (!url) continue;
    var title = fm(block, /<div class="title">\s*<a[^>]*>([^<]+)<\/a>/)
             || fm(block, /<div class="thumbnail[^"]*"[^>]*>[\s\S]*?<img[^>]*alt="([^"]+)"/);
    if (!title) continue;

    var dt = /<span class="(?:tvshows|movies)">([^<]+)<\/span>/.exec(block);
    out.push({
      url: url,
      image: pickImage(block),
      title: clean(title),
      year: fm(block, /<span class="year">(\d{4})<\/span>/) || "",
      type: dt ? clean(dt[1]) : "",
      isSeries: typeOf(url)
    });
  }
  return out;
}

function search(query, page) {
  var q = encodeURIComponent(query);
  var url = (!page || page <= 1) ? BASE + "/?s=" + q : BASE + "/page/" + page + "/?s=" + q;
  return parseSearchResults(get(url));
}

// ───────────── Detalle ─────────────
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

function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function detail(url) {
  var html = get(url), m, d = {};

  // URL de /episodio/: la página del episodio no trae sinopsis/géneros/poster → se heredan de la serie padre
  if (url.indexOf("/episodio/") !== -1) {
    var sm = /\/episodio\/([a-z0-9\-]+?)-\d+x\d+/.exec(url);
    if (sm) {
      try {
        var parent = detail(BASE + "/series/" + sm[1] + "/");
        var keys = ["synopsis", "genres", "poster", "banner", "year", "seasons", "isSeries"];
        for (var k = 0; k < keys.length; k++) if (parent[keys[k]] != null) d[keys[k]] = parent[keys[k]];
      } catch (e) { log("serie padre: " + e); }
    }
    var h1 = fm(html, /<h1>([^<]+)<\/h1>/);
    if (h1) d.title = clean(h1);
    if (!d.poster) {
      var bg = fm(html, /#dt_contenedor\{background-image:url\(([^)]+)\)/);
      if (bg) d.poster = bg.replace(/"/g, "").replace(/^\s+|\s+$/g, "");
    }
    return d;
  }

  var t = fm(html, /<div class="sheader">[\s\S]*?<div class="data">\s*<h1>([^<]+)<\/h1>/);
  if (t) d.title = clean(t);
  var p = fm(html, /<div class="poster">\s*<img[^>]*src="([^"]+)"/);
  if (p) d.poster = p;
  var b = fm(html, /#dt_contenedor\{background-image:url\(([^)]+)\)/);
  if (b) d.banner = b.replace(/"/g, "").replace(/^\s+|\s+$/g, "");
  var s = fm(html, /<div id="info"[^>]*>[\s\S]*?<p>([^<]+)<\/p>/);
  if (s) d.synopsis = clean(s);
  var y = fm(html, /<b>Año:\s*<\/b>\s*<a[^>]*>(\d{4})<\/a>/) || fm(html, /<div class="extra">\s*<span>(\d{4})\s*<\/span>/);
  if (y) d.year = y;

  m = /<div class="sgeneros">([\s\S]*?)<\/div>/.exec(html);
  if (m) {
    var g = [], gm, gre = /<a[^>]*>([^<]+)<\/a>/g;
    while ((gm = gre.exec(m[1])) !== null) g.push(clean(gm[1]));
    d.genres = g.join(", ");
  }

  // Episodios
  var episodes = [], blk, bre = /<ul class="episodios">([\s\S]*?)<\/ul>/g;
  var ere = /<a href="([^"]+)">\s*<li class="mark-(\d+)">\s*<div class="imagen">\s*<img src="([^"]+)">\s*<\/div>\s*<div class="numerando">([^<]+)<\/div>\s*<div class="episodiotitle">([^<]+)<span/g;
  while ((blk = bre.exec(html)) !== null) {
    var em;
    ere.lastIndex = 0;
    while ((em = ere.exec(blk[1])) !== null)
      episodes.push({ url: em[1], image: em[3], number: clean(em[4]), title: clean(em[5]) });
  }
  episodes.sort(function (a, c) { return epNum(c.number) - epNum(a.number); });   // más nuevo primero, como en la app

  if (episodes.length) {
    d.isSeries = true;
    d.seasons = [{ season: 1, title: "Temporada 1", episodes: episodes }];
  } else {
    d.isSeries = false;
    d.episodes = [{ title: d.title || "Ver", url: url, image: d.poster || "" }];
  }

  // Relacionados
  var related = [], rb = /<div id="single_relacionados">([\s\S]*?)<\/div>/.exec(html);
  if (rb) {
    var rm, rre = /<article>\s*<a href="([^"]+)">\s*<img src="([^"]+)"\s+alt="([^"]+)"/g;
    while ((rm = rre.exec(rb[1])) !== null) related.push({ url: rm[1], image: rm[2], title: clean(rm[3]) });
  }
  d.relatedContent = shuffle(related);
  return d;
}

// ───────────── Reproductores ─────────────
function embedUrl(post, type, nume) {
  var h = http.get(BASE + "/wp-json/dooplayer/v2/" + post + "/" + type + "/" + nume, {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": BASE + "/"
  });
  if (!h) return null;
  var m = /"embed_url"\s*:\s*"([^"]+)"/.exec(h);
  return m ? m[1].replace(/\\\//g, "/") : null;
}

function servers(episodeUrl) {
  var html = get(episodeUrl), opts = [], m;

  var re = /<li[^>]*class=["']dooplay_player_option["'][^>]*data-type=["']([^"']*)["'][^>]*data-post=["'](\d+)["'][^>]*data-nume=["'](\d+)["']/g;
  while ((m = re.exec(html)) !== null) opts.push({ type: m[1], post: m[2], nume: m[3] });

  if (!opts.length) {   // por si cambia el orden de los atributos
    var fre = /<li[^>]*dooplay_player_option[^>]*>[\s\S]*?<\/li>/g;
    while ((m = fre.exec(html)) !== null) {
      var type = fm(m[0], /data-type=["']([^"']*)["']/), post = fm(m[0], /data-post=["'](\d+)["']/), nume = fm(m[0], /data-nume=["'](\d+)["']/);
      if (post && nume) opts.push({ type: type || "tv", post: post, nume: nume });
    }
  }

  var out = [], seen = {};
  for (var i = 0; i < opts.length; i++) {
    try {
      var u = embedUrl(opts[i].post, opts[i].type, opts[i].nume);
      if (u && !seen[u]) { seen[u] = true; out.push(u); }
    } catch (e) { log("embed " + opts[i].nume + ": " + e); }
  }
  return out;
}
