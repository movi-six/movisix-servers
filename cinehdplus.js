/*
 * CineHDPlus — CineHDPlus.org · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
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

// ───────────── Filtro Anti-Anuncios (Netflix, Disney, etc) ─────────────
function isAd(url, title) {
  var u = (url || "").toLowerCase();
  var t = (title || "").toLowerCase();
  if (u.indexOf("ggpick.com") !== -1 || u.indexOf("/banners/") !== -1 || u.indexOf("subscriptions/") !== -1) return true;
  if (t.indexOf("oferta") !== -1 || t.indexOf("adquirir") !== -1 || t.indexOf("suscripción") !== -1) return true;
  if (t.indexOf("netflix") !== -1 || t.indexOf("disney") !== -1 || t.indexOf("paramount") !== -1) return true;
  return false;
}

// ───────────── Parser de Tarjetas (Cards con imágenes arregladas) ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  var re = /<a[^>]+href="(https:\/\/cinehdplus\.org\/(?:pelicula-|series-tv-)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  while ((m = re.exec(html)) !== null) {
    var url = m[1];
    var block = m[2];
    
    if (isAd(url, "")) continue;

    // Título
    var title = "";
    var altM = /<img[^>]+alt="([^"]+)"/.exec(block);
    var pM = /<p class="text-xs font-medium[^>]*>([^<]+)<\/p>/.exec(block);
    if (altM) title = altM[1].replace(/ - Película| - Serie de TV/g, "");
    else if (pM) title = pM[1];

    if (isAd(url, title) || seen[url]) continue;
    seen[url] = true;

    // Imagen (Lazy-load: data-src o src)
    var image = "";
    var imgM = /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i.exec(block);
    if (imgM) image = abs(imgM[1]);

    // Año (busca 202X seguido de un punto medio)
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

// ───────────── Búsqueda ─────────────
function search(query, page) {
  page = page || 1;
  var url = BASE + "/search/" + encodeURIComponent(query) + (page > 1 ? "/page/" + page + "/" : "/");
  try {
    var html = getHtml(url);
    var out = [], seen = {}, m;
    // Las tarjetas de búsqueda tienen otra estructura, usamos el mismo parser general
    var re = /<a[^>]+href="(https:\/\/cinehdplus\.org\/(?:pelicula-|series-tv-)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

    while ((m = re.exec(html)) !== null) {
      var itemUrl = m[1];
      var block = m[2];
      if (isAd(itemUrl, "")) continue;

      var title = "";
      var altM = /<img[^>]+alt="([^"]+)"/.exec(block);
      var h3M = /<h3[^>]*>([^<]+)<\/h3>/.exec(block);
      if (altM) title = altM[1].replace(/ - Película| - Serie de TV/g, "");
      else if (h3M) title = h3M[1];

      if (isAd(itemUrl, title) || seen[itemUrl]) continue;
      seen[itemUrl] = true;

      var image = "";
      var imgM = /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i.exec(block);
      if (imgM) image = abs(imgM[1]);

      var year = "";
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

// ───────────── Detalle ─────────────
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

// ───────────── Servidores (Bypass Completo Anti-Anuncios) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [];
  var i, btn;
  var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // 1. Recolectar botones data-url (VOE, Streamtape, Veev, Listeamed, Streamplay)
  var btnRe = /<button\b[^>]*data-url="([^"]*)"[^>]*data-domain="([^"]*)"[^>]*>/gi;
  while ((btn = btnRe.exec(html)) !== null) {
    var rawUrl = clean(btn[1]).replace(/&amp;/g, "&").replace(/&#038;/g, "&");
    var domain = clean(btn[2]);
    if (!rawUrl || !domain) continue;

    if (rawUrl.indexOf("//") === 0) rawUrl = "https:" + rawUrl;
    else if (rawUrl.charAt(0) === "/") rawUrl = BASE + rawUrl;

    var hm = /[?&]h=([^&]+)/.exec(rawUrl);
    if (!hm) continue;

    var hash = hm[1];
    var finalUrl = "";

    // PASO A: player.php → extraer goto.php
    var playerUrl = "https://api.cinehdplus.org/ir/player.php?h=" + hash;
    var playerHtml = "";
    try {
      playerHtml = getHtml(playerUrl, episodeUrl);
    } catch (e) { log("player.php error: " + e); }

    var gotoUrl = "";
    var gotoM = /href="([^"]*goto\.php\?h=[^"]+)"/i.exec(playerHtml);
    if (gotoM) {
      gotoUrl = gotoM[1].replace(/&amp;/g, "&");
      if (gotoUrl.indexOf("//") === 0) gotoUrl = "https:" + gotoUrl;
      else if (gotoUrl.charAt(0) === "/") gotoUrl = "https://api.cinehdplus.org" + gotoUrl;
    }

    // PASO B: goto.php → extraer el input hidden name="url"
    var postHash = "";
    var gotoHtml = "";
    if (gotoUrl) {
      try {
        gotoHtml = getHtml(gotoUrl, playerUrl);
      } catch (e) { log("goto.php error: " + e); }

      // <input type="hidden" id="url" name="url" value="XXXX" />
      var postM = /name="url"\s+value="([^"]+)"/i.exec(gotoHtml);
      if (!postM) postM = /id="url"[^>]*value="([^"]+)"/i.exec(gotoHtml);
      if (postM) postHash = postM[1];
    }

    // PASO C: POST a rd.php con el hash → extraer URL final
    if (postHash) {
      var rdUrl = "https://api.cinehdplus.org/ir/rd.php";
      try {
        // Verificamos si la librería soporta POST
        var rdHtml = "";
        if (typeof http.post === "function") {
          rdHtml = http.post(rdUrl, "url=" + encodeURIComponent(postHash), {
            "User-Agent": UA,
            "Referer": gotoUrl,
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"
          });
        } else {
          // Fallback usando GET si no hay POST
          var rdUrlGet = "https://api.cinehdplus.org/ir/rd.php?url=" + encodeURIComponent(postHash);
          rdHtml = getHtml(rdUrlGet, gotoUrl);
        }

        // Patrones de redirección en rd.php
        var patterns = [
          /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
          /window\.location\.replace\(["']([^"']+)["']\)/i,
          /location\.replace\(["']([^"']+)["']\)/i,
          /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i,
          /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>\s*(?:Ver|Ir|Click|Reproducir|Video)/i
        ];
        for (var p = 0; p < patterns.length; p++) {
          var mm = patterns[p].exec(rdHtml);
          if (mm && mm[1]) {
            finalUrl = mm[1].replace(/&amp;/g, "&");
            if (finalUrl.indexOf("//") === 0) finalUrl = "https:" + finalUrl;
            break;
          }
        }

        // Fallback: iframe dentro del rd.php
        if (!finalUrl) {
          var ifM = /<iframe[^>]+src=["']([^"']+)["']/i.exec(rdHtml);
          if (ifM) {
            finalUrl = ifM[1].replace(/&amp;/g, "&");
            if (finalUrl.indexOf("//") === 0) finalUrl = "https:" + finalUrl;
          }
        }
      } catch (e) { log("rd.php error: " + e); }
    }

    // Fallback: si falla todo, enviamos player.php (el WebView lo cargará sin anuncios)
    if (!finalUrl) {
      finalUrl = "https://api.cinehdplus.org/ir/player.php?h=" + hash;
    }

    var dup = false;
    for (i = 0; i < out.length; i++) { if (out[i].url === finalUrl) { dup = true; break; } }
    if (dup) continue;

    var langM = /data-lang="([^"]*)"/i.exec(btn[0]);
    var lang = langM ? clean(langM[1]) : "Latino";

    out.push({ name: domain + " [" + lang + "]", url: finalUrl, lang: lang });
  }

  // Fallback final por si no hay botones
  if (out.length === 0) {
    var ifM = /<iframe[^>]+id="main-player-iframe"[^>]+src="([^"]+)"/i.exec(html);
    if (ifM) {
      var iu = clean(ifM[1]).replace(/&amp;/g, "&").replace(/[?&]autoplay=1/, "");
      out.push({ name: "CineHDPlus", url: iu, lang: "Latino" });
    }
  }

  return out;
      }
