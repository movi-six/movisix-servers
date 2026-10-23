/*
 * CineHDPlus — CineHDPlus.org · Películas y Series
 * ES5.
 */

var BASE = (CONFIG.base || "https://cinehdplus.org").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getHtml(url, referer) {
  var headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8"
  };
  if (referer) headers["Referer"] = referer;
  else headers["Referer"] = BASE + "/";
  
  return http.get(url, headers);
}

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// ───────────── Filtro Anti-Anuncios ─────────────
function isAd(url, title) {
  var u = (url || "").toLowerCase();
  var t = (title || "").toLowerCase();
  if (u.indexOf("ggpick.com") !== -1 || u.indexOf("/banners/") !== -1 || u.indexOf("subscriptions/") !== -1) return true;
  if (t.indexOf("oferta") !== -1 || t.indexOf("adquirir") !== -1 || t.indexOf("suscripción") !== -1) return true;
  if (t.indexOf("netflix") !== -1 || t.indexOf("disney") !== -1 || t.indexOf("paramount") !== -1) return true;
  return false;
}

// ───────────── Parser de Tarjetas (Arreglado imágenes) ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  // Buscamos el bloque del enlace
  var re = /<a[^>]+href="(https:\/\/cinehdplus\.org\/(?:pelicula-|series-tv-)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  while ((m = re.exec(html)) !== null) {
    var url = m[1];
    var block = m[2];
    
    // 1. Filtro rápido de anuncios por URL
    if (isAd(url, "")) continue;

    // 2. Extraer Título
    var title = "";
    var altM = /<img[^>]+alt="([^"]+)"/.exec(block);
    var pM = /<p class="text-xs font-medium[^>]*>([^<]+)<\/p>/.exec(block);
    if (altM) title = altM[1].replace(/ - Película| - Serie de TV/g, "");
    else if (pM) title = pM[1];

    if (isAd(url, title) || seen[url]) continue;
    seen[url] = true;

    // 3. Extraer Imagen (Soportando lazy-load: data-src, data-lazy-src o src)
    var image = "";
    var imgM = /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/.exec(block);
    if (imgM) {
      image = abs(imgM[1]);
      // Si la imagen es un SVG de carga, intentamos buscar otra
      if (image.indexOf("data:image") === 0) {
         var realImgM = /<img[^>]+src="([^"]+)"/.exec(block);
         if (realImgM) image = abs(realImgM[1]);
      }
    }

    // 4. Extraer Año (buscando "202X" seguido de "·")
    var year = "";
    var yearM = /(\d{4})\s*·/.exec(block);
    if (yearM) year = yearM[1];

    var kind = (url.indexOf("/series-tv-") !== -1) ? "serie" : "movie";

    out.push({
      title: clean(title),
      url: url,
      image: image,
      rating: "",
      year: year,
      type: kind
    });
  }
  return out;
}

function list(page) {
  page = page || 1;
  var url = BASE + "/peliculas" + (page > 1 ? "/page/" + page + "/" : "/");
  return parseCards(getHtml(url));
}

function search(query, page) {
  page = page || 1;
  var url = BASE + "/search/" + encodeURIComponent(query) + (page > 1 ? "/page/" + page + "/" : "/");
  try {
    var html = getHtml(url);
    var out = [], seen = {}, m;
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

      if (isAd(itemUrl, title) || seen[itemUrl]) continue;
      seen[itemUrl] = true;

      var imgM = /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/.exec(block);
      if (imgM) image = abs(imgM[1]);

      var yearM = /(\d{4})\s*·/.exec(block);
      if (yearM) year = yearM[1];

      var kind = (itemUrl.indexOf("/series-tv-") !== -1) ? "serie" : "movie";

      out.push({ title: clean(title), url: itemUrl, image: image, rating: "", year: year, type: kind });
    }
    return out;
  } catch (e) {
    log("CineHDPlus search: error " + e);
    return [];
  }
}

function detail(url) {
  var html = getHtml(url);
  var m;
  var isSeries = url.indexOf("/series-tv-") !== -1;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: isSeries, episodes: [] };

  m = /<h2[^>]*>([\s\S]*?)<span class="text-text-secondary font-normal ml-2 opacity-60">\(\d{4}\)<\/span><\/h2>/.exec(html);
  if (!m) m = /<title>([^<]+)<\/title>/.exec(html);
  if (m) d.title = clean(m[1].replace(/<[^>]+>/g, "").replace(/Ver | Online HD| &#8211; CineHDPlus/g, ""));

  m = /<img src="([^"]+)"[^>]*alt="[^"]*"[^>]*class="object-cover size-full absolute inset-0"/.exec(html);
  if (m) d.poster = abs(m[1]);

  m = /<img src="([^"]+)"[^>]*class="object-cover opacity-20 size-full"/.exec(html);
  if (m) d.banner = abs(m[1]);

  m = /<p class="text-sm text-text-secondary leading-relaxed line-clamp-3 sm:line-clamp-6">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));
  else {
    m = /<div class="text-text-secondary leading-relaxed prose-custom text-sm md:text-base"><p>([\s\S]*?)<\/p><\/div>/.exec(html);
    if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));
  }

  m = /<span class="text-text-secondary font-normal ml-2 opacity-60">\((\d{4})\)<\/span>/.exec(html);
  if (m) d.year = m[1];

  m = /<span class="font-bold text-white tabular-nums text-sm leading-none">([^<]+)<\/span>/.exec(html);
  if (m) d.rating = m[1];

  var genres = [];
  var genreRe = /<a href="https:\/\/cinehdplus\.org\/genero\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  while ((m = genreRe.exec(html)) !== null) {
    var g = clean(m[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }
  d.genres = genres.join(", ");

  if (isSeries) {
    var seasonPane = /<div id="season-content-1"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    if (seasonPane) {
      var epRe = /<a href="([^"]+)"[^>]*class="group flex items-center gap-4[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
      while ((m = epRe.exec(seasonPane[1])) !== null) {
        d.episodes.push({ title: clean(m[2].replace(/<[^>]+>/g, "")), url: abs(m[1]), image: "" });
      }
    }
  }

  if (!isSeries || d.episodes.length === 0) {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores (Extracción Directa sin WebView) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [];
  var i, btn, m;

  // Buscamos los botones de servidor
  var btnRe = /<button\b[^>]*data-url="([^"]*)"[^>]*data-domain="([^"]*)"[^>]*>/gi;
  
  while ((btn = btnRe.exec(html)) !== null) {
    var rawUrl = clean(btn[1]).replace(/&amp;/g, "&").replace(/&#038;/g, "&");
    var domain = clean(btn[2]);
    
    if (!rawUrl || !domain) continue;
    if (rawUrl.indexOf("//") === 0) rawUrl = "https:" + rawUrl;
    else if (rawUrl.charAt(0) === "/") rawUrl = BASE + rawUrl;

    // Extraemos el hash h= del player.php
    var hm = /[?&]h=([^&]+)/.exec(rawUrl);
    if (!hm) continue;
    var hash = hm[1];

    // --- AQUÍ ESTÁ EL TRUCO ---
    // En lugar de devolver goto.php (que te manda a los anuncios),
    // hacemos la petición a player.php con el Referer correcto.
    // El player.php contiene el iframe real del servidor (VOE, Streamtape, etc.)
    var playerUrl = "https://api.cinehdplus.org/ir/player.php?h=" + hash;
    var realVideoUrl = "";

    try {
      // Pedimos el HTML del player
      var playerHtml = getHtml(playerUrl, episodeUrl); // Referer = URL del episodio
      
      // Buscamos el iframe o el script que contiene la URL real
      // Los servidores como VOE suelen estar en un <iframe src="...">
      var iframeM = /<iframe[^>]+src="([^"]+)"/i.exec(playerHtml);
      if (iframeM) {
        realVideoUrl = clean(iframeM[1]).replace(/&amp;/g, "&");
      } else {
        // Si no hay iframe, buscamos patrones de URL de VOE/Streamtape
        var voeM = /(https?:\/\/[^"']*voe[^"']*)/i.exec(playerHtml);
        if (voeM) realVideoUrl = voeM[1];
      }
    } catch (e) {
      log("Error obteniendo player real: " + e);
    }

    // Si logramos extraer el video real, lo usamos. Si no, devolvemos el player.php
    // (el WebView lo cargará, pero al menos no irá a los anuncios de goto.php)
    var finalUrl = realVideoUrl ? realVideoUrl : playerUrl;
    
    if (finalUrl.indexOf("//") === 0) finalUrl = "https:" + finalUrl;

    // Evitar duplicados
    var dup = false;
    for (i = 0; i < out.length; i++) { if (out[i].url === finalUrl) { dup = true; break; } }
    if (dup) continue;

    var langM = /data-lang="([^"]*)"/i.exec(btn[0]);
    var lang = langM ? clean(langM[1]) : "Latino";

    out.push({
      name: domain + " [" + lang + "]",
      url: finalUrl,
      lang: lang
    });
  }

  // Fallback: iframe principal
  if (out.length === 0) {
    var ifM = /<iframe[^>]+id="main-player-iframe"[^>]+src="([^"]+)"/i.exec(html);
    if (ifM) {
      var iu = clean(ifM[1]).replace(/&amp;/g, "&");
      out.push({ name: "CineHDPlus", url: iu, lang: "Latino" });
    }
  }

  return out;
        }
