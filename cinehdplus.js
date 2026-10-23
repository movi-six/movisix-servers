/*
 * CineHDPlus — CineHDPlus.org · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * ES5.
 */

var BASE = (CONFIG.base || "https://cinehdplus.org").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getHtml(url) {
  return http.get(url, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  });
}

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// Filtro estricto anti-anuncios (Netflix, Disney, etc.)
function isAd(url, title) {
  var u = (url || "").toLowerCase();
  var t = (title || "").toLowerCase();
  if (u.indexOf("ggpick.com") !== -1) return true;
  if (u.indexOf("/banners/") !== -1) return true;
  if (u.indexOf("subscriptions/") !== -1) return true;
  if (t.indexOf("oferta") !== -1 && t.indexOf("descuento") !== -1) return true;
  if (t.indexOf("adquirir") !== -1) return true;
  if (t.indexOf("suscripción") !== -1) return true;
  if (t.indexOf("netflix") !== -1) return true;
  if (t.indexOf("disney") !== -1) return true;
  if (t.indexOf("paramount") !== -1) return true;
  if (t.indexOf("max") !== -1 && t.indexOf("oferta") !== -1) return true;
  return false;
}

// ───────────── Tarjetas (Grid - Inicio) ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  // Buscamos cualquier enlace a película o serie
  var re = /<a[^>]+href="(https:\/\/cinehdplus\.org\/(?:pelicula-|series-tv-)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  while ((m = re.exec(html)) !== null) {
    var url = m[1];
    var block = m[2];
    var title = "";
    var image = "";
    var year = "";

    // 1. Filtrar anuncios por URL
    if (isAd(url, "")) continue;

    // 2. Extraer Título (usualmente en el atributo alt de la imagen o en un <p>)
    var altM = /<img[^>]+alt="([^"]+)"/.exec(block);
    var pM = /<p class="text-xs font-medium[^>]*>([^<]+)<\/p>/.exec(block);
    if (altM) title = altM[1].replace(/ - Película| - Serie de TV/g, "");
    else if (pM) title = pM[1];
    
    // 3. Filtrar anuncios por Título
    if (isAd(url, title)) continue;
    if (seen[url]) continue;
    seen[url] = true;

    // 4. Extraer Imagen (buscamos el src dentro del bloque)
    var imgM = /<img[^>]+src="([^"]+)"/.exec(block);
    if (imgM) image = abs(imgM[1]);
    
    // 5. Extraer Año (buscando el patrón "202X" o "19XX" seguido de "· Película/Serie")
    var yearM = /(\d{4})\s*·\s*(?:Película|Serie)/.exec(block);
    if (yearM) year = yearM[1];
    else {
      // Fallback: buscar el año en el bloque inferior de texto
      var pYearM = /(\d{4})\s*·/.exec(block);
      if (pYearM) year = pYearM[1];
    }

    var kind = (url.indexOf("/series-tv-") !== -1) ? "serie" : "movie";

    out.push({
      title: clean(title),
      url: url,
      image: image,
      rating: "", // No visible en la card simple
      year: year,
      type: kind
    });
  }
  return out;
}

// ───────────── Lista (Inicio) ─────────────
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
    var html = getHtml(url);
    var out = [], seen = {}, m;
    // En búsqueda, las tarjetas son horizontales
    var re = /<a[^>]+href="(https:\/\/cinehdplus\.org\/(?:pelicula-|series-tv-)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

    while ((m = re.exec(html)) !== null) {
      var itemUrl = m[1];
      var block = m[2];
      var title = "";
      var image = "";
      var year = "";

      if (isAd(itemUrl, "")) continue;

      var altM = /<img[^>]+alt="([^"]+)"/.exec(block);
      var h3M = /<h3[^>]*>([^<]+)<\/h3>/.exec(block);
      if (altM) title = altM[1].replace(/ - Película| - Serie de TV/g, "");
      else if (h3M) title = h3M[1];

      if (isAd(itemUrl, title)) continue;
      if (seen[itemUrl]) continue;
      seen[itemUrl] = true;

      var imgM = /<img[^>]+src="([^"]+)"/.exec(block);
      if (imgM) image = abs(imgM[1]);

      var yearM = /(\d{4})\s*·/.exec(block);
      if (yearM) year = yearM[1];

      var kind = (itemUrl.indexOf("/series-tv-") !== -1) ? "serie" : "movie";

      out.push({
        title: clean(title),
        url: itemUrl,
        image: image,
        rating: "",
        year: year,
        type: kind
      });
    }
    return out;
  } catch (e) {
    log("CineHDPlus search: error " + e);
    return [];
  }
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url);
  var m;
  var isSeries = url.indexOf("/series-tv-") !== -1;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: isSeries, episodes: [] };

  // Título
  m = /<h2[^>]*>([\s\S]*?)<span class="text-text-secondary font-normal ml-2 opacity-60">\(\d{4}\)<\/span><\/h2>/.exec(html);
  if (!m) m = /<title>([^<]+)<\/title>/.exec(html);
  if (m) d.title = clean(m[1].replace(/<[^>]+>/g, "").replace(/Ver | Online HD| &#8211; CineHDPlus/g, ""));

  // Póster
  m = /<img src="([^"]+)"[^>]*alt="[^"]*"[^>]*class="object-cover size-full absolute inset-0"/.exec(html);
  if (m) d.poster = abs(m[1]);

  // Banner
  m = /<img src="([^"]+)"[^>]*class="object-cover opacity-20 size-full"/.exec(html);
  if (m) d.banner = abs(m[1]);

  // Sinopsis
  m = /<p class="text-sm text-text-secondary leading-relaxed line-clamp-3 sm:line-clamp-6">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));
  else {
    m = /<div class="text-text-secondary leading-relaxed prose-custom text-sm md:text-base"><p>([\s\S]*?)<\/p><\/div>/.exec(html);
    if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));
  }

  // Año
  m = /<span class="text-text-secondary font-normal ml-2 opacity-60">\((\d{4})\)<\/span>/.exec(html);
  if (m) d.year = m[1];

  // Rating
  m = /<span class="font-bold text-white tabular-nums text-sm leading-none">([^<]+)<\/span>/.exec(html);
  if (m) d.rating = m[1];

  // Géneros
  var genres = [];
  var genreRe = /<a href="https:\/\/cinehdplus\.org\/genero\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  while ((m = genreRe.exec(html)) !== null) {
    var g = clean(m[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }
  d.genres = genres.join(", ");

  // Episodios (Temporada 1)
  if (isSeries) {
    var seasonPane = /<div id="season-content-1"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    if (seasonPane) {
      var epRe = /<a href="([^"]+)"[^>]*class="group flex items-center gap-4[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
      while ((m = epRe.exec(seasonPane[1])) !== null) {
        d.episodes.push({
          title: clean(m[2].replace(/<[^>]+>/g, "")),
          url: abs(m[1]),
          image: ""
        });
      }
    }
  }

  if (!isSeries || d.episodes.length === 0) {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores (CineHDPlus) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [];
  var i, btn, m;

  var btnRe = /<button\b[^>]*>/gi;
  while ((btn = btnRe.exec(html)) !== null) {
    var tag = btn[0];
    var uM = /\bdata-url\s*=\s*"([^"]*)"/i.exec(tag);
    var dM = /\bdata-domain\s*=\s*"([^"]*)"/i.exec(tag);
    if (!uM || !dM) continue;

    var rawUrl = clean(uM[1]).replace(/&amp;/g, "&").replace(/&#038;/g, "&");
    var domain = clean(dM[1]);
    if (!rawUrl || !domain) continue;

    if (rawUrl.indexOf("//") === 0) rawUrl = "https:" + rawUrl;
    else if (rawUrl.charAt(0) === "/") rawUrl = BASE + rawUrl;

    // Extraer el h= y construir goto.php directamente
    var hm = /[?&]h=([^&]+)/.exec(rawUrl);
    if (!hm) continue;
    var gotoUrl = "https://api.cinehdplus.org/ir/goto.php?h=" + hm[1];

    var dup = false;
    for (i = 0; i < out.length; i++) { if (out[i].url === gotoUrl) { dup = true; break; } }
    if (dup) continue;

    var langM = /\bdata-lang\s*=\s*"([^"]*)"/i.exec(tag);
    var lang = langM ? clean(langM[1]) : "Latino";

    out.push({
      name: domain + " [" + lang + "]",
      url: gotoUrl,
      lang: lang
    });
  }

  // Fallback: iframe principal
  if (out.length === 0) {
    var ifM = /<iframe[^>]+id="main-player-iframe"[^>]+src="([^"]+)"/i.exec(html);
    if (ifM) {
      var iu = clean(ifM[1]).replace(/&amp;/g, "&");
      var hm2 = /[?&]h=([^&]+)/.exec(iu);
      if (hm2) {
        out.push({
          name: "CineHDPlus",
          url: "https://api.cinehdplus.org/ir/goto.php?h=" + hm2[1],
          lang: "Latino"
        });
      }
    }
  }

  return out;
    }
