var BASE = (CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("CONFIG.base no está definido en el index.json");

var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0"
};

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function str(v) { return (v === undefined || v === null) ? "" : String(v); }

function getHtml(url, referer) {
  var h = { "User-Agent": HEADERS["User-Agent"] };
  if (referer) h["Referer"] = referer;
  var body;
  try { body = http.get(url, h); }
  catch (e) { log("Doramas GET error " + url + ": " + e); return ""; }
  if (!body) { log("Doramas sin respuesta (HTTP " + http.status() + ") " + url); return ""; }
  return body;
}

function getJson(url, referer) {
  var text = getHtml(url, referer);
  if (!text) return null;
  text = String(text).trim();
  if (text.charAt(0) === "<") return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function abs(u) {
  u = str(u);
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// ───────────── Filtros (Opcional, si tu app los soporta) ─────────────
function filters() {
  return [
    {
      type: "select", key: "tipo", label: "Tipo",
      options: [
        { value: "", name: "Todos" },
        { value: "dorama", name: "Doramas" },
        { value: "serie", name: "Series" }
      ]
    },
    {
      type: "select", key: "estado", label: "Estado",
      options: [
        { value: "", name: "Todos" },
        { value: "completo", name: "Completos" },
        { value: "emision", name: "En Emisión" }
      ]
    },
    {
      type: "select", key: "idioma", label: "Idioma",
      options: [
        { value: "", name: "Todos" },
        { value: "latino", name: "Latino" },
        { value: "subtitulado", name: "Subtitulado" }
      ]
    }
  ];
}

// ───────────── Lista / Home ─────────────
function list(page, f) {
  page = page || 1;
  var o = f || {};
  
  var hasFilter = (o.tipo || o.estado || o.idioma || o.pais);
  var path = "/tipo/dorama/"; 
  
  if (hasFilter) {
    if (o.estado === "completo") path = "/estado/completo/";
    else if (o.estado === "emision") path = "/estado/emision/";
    else if (o.idioma === "latino") path = "/audio/latino/";
    else if (o.idioma === "subtitulado") path = "/audio/subtitulado/";
    else if (o.pais) path = "/pais/" + o.pais + "/";
    else if (o.tipo === "dorama") path = "/tipo/dorama/";
    else if (o.tipo === "serie") path = "/tipo/serie/";
  }

  var url = BASE + path;
  if (page > 1) url = BASE + path.replace(/\/$/, "") + "/page/" + page + "/";

  var html = getHtml(url);
  if (!html) return [];

  var out = [];
  var re = /<article[^>]*id="post-\d+"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g;
  var m;
  
  while ((m = re.exec(html)) !== null) {
    var classes = m[1];
    var c = m[2];
    
    var a = /<h3><a href="([^"]+)"/.exec(c) || /<div class="poster">[\s\S]*?<a href="([^"]+)"/.exec(c);
    if (!a) continue;
    var href = abs(a[1]);
    
    var t = /<h3><a[^>]*>([^<]+)<\/a>/.exec(c);
    var img = /<div class="poster">[\s\S]*?<img src="([^"]+)"/.exec(c);
    
    var isTv = classes.indexOf("tvshows") !== -1 || href.indexOf("/series/") !== -1;
    
    out.push({
      title: clean(t ? t[1] : ""),
      url: href,
      image: abs(img ? img[1] : ""),
      type: isTv ? "serie" : "movie",
      kind: isTv ? "serie" : "movie"
    });
  }
  return out;
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  if (!query) return [];
  page = page || 1;
  
  var url = BASE + "/?s=" + encodeURIComponent(query);
  if (page > 1) url = BASE + "/page/" + page + "/?s=" + encodeURIComponent(query);

  var html = getHtml(url);
  if (!html) return [];

  var out = [];
  var re = /<div[^>]*class="[^"]*result-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  var m;
  
  while ((m = re.exec(html)) !== null) {
    var c = m[1];
    var a = /<a[^>]+href="([^"]+)"/.exec(c);
    if (!a) continue;

    var t = /<div[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/.exec(c);
    var img = /<img[^>]+src="([^"]+)"/.exec(c);

    out.push({
      title: clean(t ? t[1] : ""),
      url: abs(a[1]),
      image: abs(img ? img[1] : ""),
      type: "serie",
      kind: "serie"
    });
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url);
  if (!html) return null;

  var m, d = {};
  
  // 1. Título y Sinopsis (igual que en tu ejemplo)
  m = /<h1>([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);
  
  m = /<div itemprop="description" class="wp-content">\s*<p>([\s\S]*?)<\/p>/.exec(html) || /<meta name="description" content="([^"]+)"/.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " "));

  // 2. Año y Puntuación
  m = /<span>(\d{4})\s*<\/span>/.exec(html);
  if (m) d.year = clean(m[1]);

  m = /<span class="dt_rating_vgs"[^>]*>([^<]+)<\/span>/.exec(html);
  if (m) d.rating = clean(m[1]) + "/10";

  // 3. Póster y Banner (Buscando la imagen del póster real)
  m = /<div class="poster">\s*<img itemprop="image" src="([^"]+)"/.exec(html) || /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (m) {
    d.poster = clean(m[1].replace(/\n/g, ""));
    d.banner = d.poster;
  }

  // 4. Géneros
  var gs = [], gre = /<a href="[^"]*\/genre\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  while ((m = gre.exec(html)) !== null) gs.push(clean(m[1]));
  if (gs.length) d.genres = gs.join(", ");

  // 5. Detectar si es Serie o Película
  var isSeries = html.indexOf('class="episodios"') !== -1 || url.indexOf("/series/") !== -1;
  d.isSeries = isSeries;

  if (isSeries) {
    // Extraer episodios exactamente como están en el HTML de doramafox
    var eps = [];
    var epRe = /<li[^>]*>[\s\S]*?<a href="([^"]+)">[\s\S]*?<div class="imagen">[\s\S]*?<img src="([^"]+)"/g;
    var matchEp;
    while ((matchEp = epRe.exec(html)) !== null) {
      var epUrl = abs(matchEp[1]);
      var epImg = abs(matchEp[2]);
      
      // Obtener nombre y número del episodio si está disponible
      var epTitle = "Episodio";
      var epNumMatch = /episodio-(\d+)/.exec(epUrl);
      var epSeasonMatch = /temporada-(\d+)/.exec(epUrl);
      if (epNumMatch) {
         var season = epSeasonMatch ? epSeasonMatch[1] : "1";
         epTitle = "Temporada " + season + " Episodio " + epNumMatch[1];
      }

      eps.push({
        title: epTitle,
        url: epUrl,
        image: epImg,
        season: epSeasonMatch ? parseInt(epSeasonMatch[1], 10) : 1,
        episode: epNumMatch ? parseInt(epNumMatch[1], 10) : eps.length + 1
      });
    }
    
    // Si no encontró episodios con la estructura de imagen, intenta con el título
    if (eps.length === 0) {
      var epRe2 = /<a href="([^"]+)">\s*<div class="episodiotitle">[\s\S]*?<span class="date">([^<]+)<\/span>/g;
      while ((matchEp = epRe2.exec(html)) !== null) {
        eps.push({
          title: clean(matchEp[2]),
          url: abs(matchEp[1]),
          image: d.poster,
          season: 1,
          episode: eps.length + 1
        });
      }
    }

    d.episodes = eps;
  } else {
    // Es película: un solo botón
    d.episodes = [{ title: "Ver Película", url: url, image: d.poster }];
  }

  return d;
}

// ───────────── Servidores ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  if (!html) return [];

  var out = [];
  var re = /<li[^>]*class="dooplay_player_option"[^>]*data-post="(\d+)"[^>]*data-type="([^"]+)"[^>]*data-nume="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  var m;
  
  while ((m = re.exec(html)) !== null) {
    var post = m[1];
    var type = m[2];
    var nume = m[3];
    var inner = m[4];

    var titleM = /<span class="title">([^<]+)<\/span>/.exec(inner);
    var serverName = titleM ? clean(titleM[1]) : "Server " + nume;

    var apiUrl = BASE + "/wp-json/dooplayer/v2/" + post + "/" + type + "/" + nume;
    var j = getJson(apiUrl, episodeUrl);

    if (j && j.embed_url) {
      var embed = j.embed_url.replace(/\\/g, "");
      out.push({
        url: embed,
        name: serverName
      });
    }
  }
  
  return out;
}
