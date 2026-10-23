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

// ───────────── Parseo de Tarjetas (Grid) ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  // Busca bloques de tarjetas en la página de películas/series
  var re = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<div class="relative aspect-2\/3[\s\S]*?<img[^>]+src="([^"]+)"[^>]*alt="([^"]+)"[\s\S]*?<\/a>/g;

  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]);
    if (seen[url]) continue;
    seen[url] = true;

    // Determinar si es serie o película basado en la URL
    var kind = (url.indexOf("/series-tv-") !== -1 || url.indexOf("/episodio-") !== -1) ? "serie" : "movie";

    // Extraer año y rating (búsqueda simple en el bloque)
    var block = html.substring(m.index, m.index + 1500);
    var yearMatch = /(\d{4})/.exec(block);
    var year = yearMatch ? yearMatch[1] : "";

    var ratingMatch = /<span class="font-bold text-white tabular-nums text-\[11px\]">([^<]+)<\/span>/.exec(block);
    var rating = ratingMatch ? ratingMatch[1] : "";

    out.push({
      title: clean(m[3]),
      url: url,
      image: abs(m[2]),
      rating: rating,
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
    // Busca los resultados de la búsqueda (lista horizontal)
    var re = /<div class="group relative bg-slate-800\/20[\s\S]*?<a href="([^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"[^>]*alt="([^"]+)"[\s\S]*?<\/div>/g;

    while ((m = re.exec(html)) !== null) {
      var itemUrl = abs(m[1]);
      if (seen[itemUrl]) continue;
      seen[itemUrl] = true;

      var kind = (itemUrl.indexOf("/series-tv-") !== -1) ? "serie" : "movie";
      
      // Extraer año y rating del bloque
      var block = html.substring(m.index, m.index + 2500);
      var yearMatch = /(\d{4})/.exec(block);
      var year = yearMatch ? yearMatch[1] : "";
      
      var ratingMatch = /<span class="font-bold text-white tabular-nums text-\[11px\] leading-none">([^<]+)<\/span>/.exec(block);
      var rating = ratingMatch ? ratingMatch[1] : "";

      out.push({
        title: clean(m[3]),
        url: itemUrl,
        image: abs(m[2]),
        rating: rating,
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

  // Banner (Fondo)
  m = /<img src="([^"]+)"[^>]*class="object-cover opacity-20 size-full"/.exec(html);
  if (m) d.banner = abs(m[1]);

  // Sinopsis
  m = /<p class="text-sm text-text-secondary leading-relaxed line-clamp-3 sm:line-clamp-6">([\s\S]*?)<\/p>/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));
  else {
    // Fallback para sinopsis en la sección de información general
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

  // Si es serie, extraer episodios de la Temporada 1
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

  // Si no hay episodios o es película, añadir la URL principal
  if (!isSeries || d.episodes.length === 0) {
    d.episodes.push({ title: d.title || "Ver", url: url, image: "" });
  }

  return d;
}

// ───────────── Servidores (CineHDPlus) ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  var out = [];
  var m;
  
  // Extraer todos los botones de servidor
  // Patrón: <button data-url="..." data-domain="..." data-lang="..." ...>
  var re = /<button[^>]+data-url="([^"]+)"[^>]+data-domain="([^"]+)"[^>]+data-lang="([^"]+)"[^>]+data-type="server"[^>]*>/g;
  
  while ((m = re.exec(html)) !== null) {
    var rawUrl = m[1];
    var domain = m[2];
    var lang = m[3];

    // Limpiar la URL (puede tener entidades HTML o caracteres escapados)
    var url = rawUrl.replace(/&amp;/g, "&");
    
    // Si la URL es relativa (empieza con //), añadir https:
    if (url.indexOf("//") === 0) {
      url = "https:" + url;
    } else if (url.indexOf("/") === 0) {
      url = BASE + url;
    }

    // Solo añadir si no está duplicado
    var exists = false;
    for (var i = 0; i < out.length; i++) {
      if (out[i].url === url) {
        exists = true;
        break;
      }
    }

    if (!exists) {
      out.push({
        name: domain + " [" + lang + "]",
        url: url,
        lang: lang
      });
    }
  }

  // Si no se encuentran servidores, intentar buscar el iframe principal
  if (out.length === 0) {
    var iframeMatch = /<iframe[^>]+id="main-player-iframe"[^>]+src="([^"]+)"/.exec(html);
    if (iframeMatch) {
      var iframeUrl = iframeMatch[1];
      if (iframeUrl.indexOf("//") === 0) iframeUrl = "https:" + iframeUrl;
      out.push({ name: "Servidor Principal", url: iframeUrl, lang: "Latino" });
    }
  }

  return out;
      }
