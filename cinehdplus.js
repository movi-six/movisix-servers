/*
 * CineHDPlus — CineHDPlus.org · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 */

var BASE = (CONFIG.base || "https://cinehdplus.org").replace(/\/+$/, "");
var API = "https://api.cinehdplus.org/ir/";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getHtml(url, referer) {
  var headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8"
  };
  headers["Referer"] = referer ? referer : BASE + "/";
  return http.get(url, headers);
}

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// Resuelve links relativos contra la URL de la página que los contiene
function resolveUrl(base, link) {
  link = clean(link);
  if (!link) return "";
  if (/^https?:/i.test(link)) return link;
  if (link.indexOf("//") === 0) return "https:" + link;
  var om = /^(https?:\/\/[^\/]+)/i.exec(base);
  var origin = om ? om[1] : BASE;
  if (link.charAt(0) === "/") return origin + link;
  return base.replace(/[?#].*$/, "").replace(/[^\/]*$/, "") + link;
}

// Lee un atributo de una etiqueta
function attrOf(tag, name) {
  var m = new RegExp("[\\s\"']" + name + "=\"([^\"]*)\"", "i").exec(tag);
  return m ? clean(m[1]) : "";
}

function stripTags(s) { return clean(String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); }

// ───────────── Filtro Anti-Anuncios ─────────────
function isAd(url, title) {
  var u = (url || "").toLowerCase();
  var t = (title || "").toLowerCase();
  if (u.indexOf("ggpick.com") !== -1 || u.indexOf("/banners/") !== -1 || u.indexOf("subscriptions/") !== -1) return true;
  if (t.indexOf("oferta") !== -1 || t.indexOf("adquirir") !== -1 || t.indexOf("suscripción") !== -1) return true;
  if (t.indexOf("netflix") !== -1 || t.indexOf("disney") !== -1 || t.indexOf("paramount") !== -1) return true;
  return false;
}

function isContentUrl(u) {
  return /^https:\/\/cinehdplus\.org\/(?:pelicula|series-tv)-\d+\//.test(u || "");
}
function isSeriesUrl(u) {
  u = u || "";
  return u.indexOf("/series-tv-") !== -1 || u.indexOf("/episodio-") !== -1 || u.indexOf("/temporadas-tv-") !== -1;
}

// ───────────── Imágenes ─────────────
function fixImage(src, size) {
  src = str(src).replace(/&#0*38;/g, "&").replace(/&amp;/g, "&").replace(/^\s+|\s+$/g, "");
  if (!src) return "";
  if (src.indexOf("//") === 0) src = "https:" + src;
  if (src.indexOf("/wp-json/rm/v1/img/") !== -1) {
    var pm = /[?&]src=([^&]+)/.exec(src);
    var om = /[?&]origin=([^&]+)/.exec(src);
    if (pm) {
      var path;
      try { path = decodeURIComponent(pm[1]); } catch (e) { path = pm[1]; }
      if (path.charAt(0) !== "/") path = "/" + path;
      if (om && om[1] === "tmdb") return "https://image.tmdb.org/t/p/" + (size || "w342") + path;
      return BASE + path;
    }
  }
  return abs(src);
}

function firstImage(block, size) {
  var re = /<img\b[^>]*>/gi, m;
  while ((m = re.exec(block)) !== null) {
    var s = attrOf(m[0], "src");
    if (!s || /\.svg(\?|$)/i.test(s) || s.indexOf("/idiomas/") !== -1) continue;
    return fixImage(s, size);
  }
  return "";
}

// ───────────── Parser de Tarjetas ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  var reTag = /<a\s[^>]*>/g;

  while ((m = reTag.exec(html)) !== null) {
    var tag = m[0];
    var url = attrOf(tag, "href");
    if (!isContentUrl(url) || isAd(url, "") || seen[url]) continue;

    var cls = attrOf(tag, "class");
    var start = m.index + tag.length;
    var block = "", title = "";

    if (cls.indexOf("absolute inset-0") !== -1) {
      block = html.substr(start, 3500);
      var nx = block.search(/<a\s[^>]*absolute inset-0/);
      if (nx > 0) block = block.substr(0, nx);
      title = attrOf(tag, "aria-label");
      if (!title) {
        var h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block);
        if (h3) title = stripTags(h3[1]);
      }
    } else if (/(^|\s)group(\s|$)/.test(cls)) {
      var end = html.indexOf("</a>", start);
      block = html.substring(start, end < 0 ? start + 3500 : end);
      var pM = /<p[^>]*font-medium[^>]*>([\s\S]*?)<\/p>/.exec(block);
      if (pM) title = stripTags(pM[1]);
      if (!title) {
        var altM = /<img[^>]*\salt="([^"]+)"/.exec(block);
        if (altM) title = clean(altM[1]).replace(/ - Película| - Serie de TV/g, "");
      }
    } else {
      continue;
    }

    var image = firstImage(block, "w342");
    if (!title || !image) continue;
    if (isAd(url, title)) continue;
    seen[url] = true;

    var year = "";
    var yM = /(\d{4})\s*·/.exec(block);
    if (!yM) yM = /\b((?:19|20)\d{2})\b/.exec(stripTags(block));
    if (yM) year = yM[1];

    out.push({
      title: title,
      url: url,
      image: image,
      rating: "",
      year: year,
      type: isSeriesUrl(url) ? "serie" : "movie"
    });
  }
  return out;
}

function list(page) {
  page = page || 1;
  var url = BASE + "/peliculas" + (page > 1 ? "/page/" + page + "/" : "/");
  return parseCards(getHtml(url));
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  var url = BASE + "/search/" + encodeURIComponent(query) + (page > 1 ? "/page/" + page + "/" : "/");
  try {
    return parseCards(getHtml(url));
  } catch (e) {
    log("CineHDPlus search: error " + e);
    return [];
  }
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url);
  var m;
  var isSeries = isSeriesUrl(url) || html.indexOf('id="rm-seasons-module"') !== -1;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: isSeries, episodes: [] };

  m = /<h2[^>]*font-bold[^>]*>([\s\S]*?)<\/h2>/.exec(html);
  if (m) d.title = stripTags(m[1].replace(/<span[\s\S]*?<\/span>/g, ""));
  if (!d.title) {
    m = /<title>([^<]+)<\/title>/.exec(html);
    if (m) d.title = clean(m[1].replace(/^Ver |\s*Online HD.*$/g, "").replace(/\s*\(\d{4}\)\s*$/, ""));
  }

  m = /<img\b[^>]*\ssrc="([^"]+)"[^>]*class="object-cover size-full absolute inset-0"/.exec(html);
  if (m) d.poster = fixImage(m[1], "w500");
  if (!d.poster) {
    m = /<meta property=['"]og:image['"] content=['"]([^'"]+)['"]/.exec(html);
    if (m) d.poster = fixImage(m[1], "w500");
  }

  m = /<img\b[^>]*\ssrc="([^"]+)"[^>]*class="object-cover opacity-20 size-full"/.exec(html);
  if (m) d.banner = fixImage(m[1], "w1280");

  m = /<p class="text-sm text-text-secondary leading-relaxed line-clamp-3 sm:line-clamp-6">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = stripTags(m[1]);
  else {
    m = /<div class="text-text-secondary leading-relaxed prose-custom[^"]*"><p>([\s\S]*?)<\/p><\/div>/.exec(html);
    if (m) d.synopsis = stripTags(m[1]);
  }

  m = /<span class="text-text-secondary font-normal ml-2 opacity-60">\((\d{4})\)<\/span>/.exec(html);
  if (m) d.year = m[1];

  m = /<span class="font-bold text-white tabular-nums text-sm leading-none">([^<]+)<\/span>/.exec(html);
  if (m) d.rating = clean(m[1]);

  var headStart = html.search(/<h2[^>]*font-bold/);
  var headEnd = html.indexOf('id="rm-post-history"');
  var head = html.substring(headStart < 0 ? 0 : headStart, headEnd > 0 ? headEnd : Math.min(html.length, 60000));
  var genres = [];
  var genreRe = /<a\b[^>]*href="https:\/\/cinehdplus\.org\/genero\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  while ((m = genreRe.exec(head)) !== null) {
    var g = clean(m[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }
  d.genres = genres.join(", ");

  if (isSeries) {
    var posRe = /id="season-content-(\d+)"/g;
    var marks = [];
    while ((m = posRe.exec(html)) !== null) marks.push({ n: parseInt(m[1], 10), at: m.index });

    var multi = marks.length > 1;
    for (var i = 0; i < marks.length; i++) {
      var pane = html.substring(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : html.length);
      var epRe = /<a\s+href="([^"]*\/episodio-[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      var em;
      while ((em = epRe.exec(pane)) !== null) {
        var eurl = clean(em[1]);
        var nm = /-(\d+)x(\d+)\/?$/.exec(eurl);
        var num = nm ? parseInt(nm[2], 10) : 0;
        var h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(em[2]);
        var et = h3 ? stripTags(h3[1]) : ("Episodio " + num);
        d.episodes.push({
          title: multi ? ("T" + marks[i].n + " · " + et) : et,
          url: abs(eurl),
          image: firstImage(em[2], "w300"),
          season: marks[i].n,
          number: num
        });
      }
    }
  } else {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores (WebView Fallback) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [], seen = {};
  var btn;

  // Buscar botones de servidor (VOE, Streamtape, Veev, etc.)
  var btnRe = /<button\b[^>]*data-type="server"[^>]*>/gi;
  while ((btn = btnRe.exec(html)) !== null) {
    var rawUrl = resolveUrl(BASE + "/", attrOf(btn[0], "data-url"));
    var domain = attrOf(btn[0], "data-domain");
    var lang = attrOf(btn[0], "data-lang") || "Latino";
    
    // Ignorar si no hay URL o dominio
    if (!rawUrl || !domain) continue;

    // Limpiar URL para WebView (quitar autoplay forzado)
    var playerUrl = rawUrl.replace(/[?&]autoplay=1/, "");

    // Evitar duplicados
    if (seen[playerUrl]) continue;
    seen[playerUrl] = true;

    // Enviamos el player.php. El WebView resolverá el AES sin anuncios.
    out.push({ 
        name: domain + " [" + lang + "]", 
        url: playerUrl, 
        lang: lang 
    });
  }

  // Fallback: Iframe principal
  if (out.length === 0) {
    var ifM = /<iframe[^>]+id="main-player-iframe"[^>]+src="([^"]+)"/i.exec(html);
    if (ifM) {
      var iu = resolveUrl(BASE + "/", ifM[1]).replace(/[?&]autoplay=1/, "");
      out.push({ name: "CineHDPlus", url: iu, lang: "Latino" });
    }
  }

  return out;
}
