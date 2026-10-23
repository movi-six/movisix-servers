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
// (goto.php viene relativo a /ir/, sin "/" inicial).
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

// Lee un atributo de una etiqueta suelta, sin importar el orden de los atributos
function attrOf(tag, name) {
  var m = new RegExp("[\\s\"']" + name + "=\"([^\"]*)\"", "i").exec(tag);
  return m ? clean(m[1]) : "";
}

function stripTags(s) { return clean(String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")); }

// ───────────── Filtro Anti-Anuncios (Netflix, Disney, etc) ─────────────
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
// El HTML trae:  .../wp-json/rm/v1/img/?src=/abc.jpg&#038;w=300&#038;origin=tmdb
// Con el "&#038;" sin decodificar la URL queda rota (se ve el placeholder).
// Se convierte a la URL directa de TMDB (o al archivo local del sitio).
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

// Primer <img> que sea un póster/captura real (ignora banderas de idioma .svg)
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
// Hay 2 layouts:
//  A) home:     <a class="group ..." href="/pelicula-ID/..."> <img> <p class="... font-medium">Título</p> </a>
//  B) búsqueda: <a href="..." class="absolute inset-0 z-10" aria-label="Título"></a> + <h3> + <img> (hermanos)
// Los <a> del hero ("Ver Detalles") no tienen imagen ni título: se saltan SIN marcarlos como vistos
// (antes se marcaban y tapaban la card real, por eso salían datos vacíos).
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
      // Layout B
      block = html.substr(start, 3500);
      var nx = block.search(/<a\s[^>]*absolute inset-0/);
      if (nx > 0) block = block.substr(0, nx);
      title = attrOf(tag, "aria-label");
      if (!title) {
        var h3 = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block);
        if (h3) title = stripTags(h3[1]);
      }
    } else if (/(^|\s)group(\s|$)/.test(cls)) {
      // Layout A
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

  // Géneros: SOLO los de la cabecera (el footer lista los ~28 géneros del sitio).
  // En la cabecera el <a> trae class antes que href.
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
    // Antes: /<div id="season-content-1">([\s\S]*?)<\/div>/ cortaba en el primer </div> interno,
    // no encontraba episodios y metía la URL de la serie como "episodio" -> se veía como película.
    // Ahora se recorren TODAS las temporadas por posición del id="season-content-N".
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
    // Película: la URL del servidor es la misma del detalle
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores (player.php → goto.php → rd.php) ─────────────
function extractRedirect(body) {
  body = str(body);
  var patterns = [
    /(?:window\.|top\.|self\.|document\.)?location\.replace\s*\(\s*["'`]([^"'`]+)["'`]/i,
    /(?:window\.|top\.|self\.|document\.)?location\.assign\s*\(\s*["'`]([^"'`]+)["'`]/i,
    /(?:window\.|top\.|self\.|document\.)?location(?:\.href)?\s*=(?!=)\s*["'`]([^"'`]+)["'`]/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i,
    /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>\s*(?:Ver|Ir|Click|Reproducir|Video)/i
  ];
  var found = "";
  for (var p = 0; p < patterns.length; p++) {
    var mm = patterns[p].exec(body);
    if (mm && mm[1]) { found = mm[1]; break; }
  }
  if (!found) {
    var ifM = /<iframe[^>]+src=["']([^"']+)["']/i.exec(body);
    if (ifM) found = ifM[1];
  }
  if (!found) { // última opción: primera URL externa dentro de la respuesta
    var re = /https?:\\?\/\\?\/[^"'\s<>]+/g, um;
    while ((um = re.exec(body)) !== null) {
      var cand = um[0].replace(/\\\//g, "/");
      if (cand.indexOf("cinehdplus.org") === -1) { found = cand; break; }
    }
  }
  if (!found) return "";
  found = found.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&").replace(/^\s+|\s+$/g, "");
  if (found.indexOf("//") === 0) found = "https:" + found;
  if (!/^https?:/i.test(found)) return "";
  return found;
}

function resolveReal(playerUrl, referer) {
  // PASO A: player.php → <a href="goto.php?h=..."> (viene RELATIVO a /ir/)
  var playerHtml = getHtml(playerUrl, referer);
  var gm = /<a[^>]*href\s*=\s*["']([^"']*goto\.php[^"']*)["']/i.exec(playerHtml)
        || /["']([^"'\s]*goto\.php\?[^"'\s]+)["']/i.exec(playerHtml);
  if (!gm) return "";
  var gotoUrl = resolveUrl(playerUrl, gm[1]);

  // PASO B: goto.php → <form action="rd.php" method="POST"> con sus <input>
  var gotoHtml = getHtml(gotoUrl, playerUrl);
  var fm = /<form[^>]*action\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/i.exec(gotoHtml);
  var action = (fm && fm[1]) ? resolveUrl(gotoUrl, fm[1]) : API + "rd.php";
  var scope = fm ? fm[2] : gotoHtml;

  var pairs = [], inRe = /<input\b[^>]*>/gi, im;
  while ((im = inRe.exec(scope)) !== null) {
    var name = attrOf(im[0], "name");
    if (!name) continue;
    pairs.push(encodeURIComponent(name) + "=" + encodeURIComponent(attrOf(im[0], "value")));
  }
  if (!pairs.length) return "";
  var body = pairs.join("&");

  // PASO C: POST a rd.php → script con el redirect al servidor real
  var rdHtml = "";
  if (typeof http.post === "function") {
    rdHtml = http.post(action, body, {
      "User-Agent": UA,
      "Referer": gotoUrl,
      "Origin": "https://api.cinehdplus.org",
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"
    });
  } else {
    rdHtml = getHtml(action + (action.indexOf("?") === -1 ? "?" : "&") + body, gotoUrl);
  }
  var real = extractRedirect(rdHtml);
  return real ? resolveUrl(action, real) : "";
}

function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [], seen = {};
  var btn;

  // Botones de servidor (el de trailer tiene data-type="trailer" y se ignora)
  var btnRe = /<button\b[^>]*data-type="server"[^>]*>/gi;
  while ((btn = btnRe.exec(html)) !== null) {
    var rawUrl = resolveUrl(BASE + "/", attrOf(btn[0], "data-url"));
    var domain = attrOf(btn[0], "data-domain");
    var lang = attrOf(btn[0], "data-lang") || "Latino";
    if (!rawUrl || !domain) continue;

    var finalUrl = "";
    try {
      finalUrl = resolveReal(rawUrl, episodeUrl);
    } catch (e) { log("CineHDPlus " + domain + " error: " + e); }

    // Si falla todo, se envía player.php (el WebView lo cargará)
    if (!finalUrl) finalUrl = rawUrl;

    if (seen[finalUrl]) continue;
    seen[finalUrl] = true;
    out.push({ name: domain + " [" + lang + "]", url: finalUrl, lang: lang });
  }

  // Fallback final por si no hay botones
  if (out.length === 0) {
    var ifM = /<iframe[^>]+id="main-player-iframe"[^>]+src="([^"]+)"/i.exec(html);
    if (ifM) {
      var iu = resolveUrl(BASE + "/", ifM[1]).replace(/[?&]autoplay=1/, "");
      out.push({ name: "CineHDPlus", url: iu, lang: "Latino" });
    }
  }

  return out;
}
