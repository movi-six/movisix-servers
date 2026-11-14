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

// Lee un atributo de una etiqueta HTML (comillas simples o dobles, cualquier orden)
function attr(tag, name) {
  var m = new RegExp("[\\s\"']" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag);
  if (!m) return "";
  return m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : "");
}

// ───────────── Filtros ─────────────
// Cada sección del sitio es una URL distinta (no se pueden combinar), por eso es un solo selector
var SECTIONS = [
  { value: "", name: "Doramas (por defecto)", path: "/tipo/dorama/" },
  // TODO
  { value: "completo", name: "Completos", path: "/estado/completo/" },
  { value: "emision", name: "En Emisión", path: "/estado/emision/" },
  { value: "latino", name: "Latino", path: "/audio/latino/" },
  { value: "subtitulado", name: "Subtitulado", path: "/audio/subtitulado/" },
  // CATEGORÍAS
  { value: "dorama", name: "Doramas", path: "/tipo/dorama/" },
  { value: "serie", name: "Series", path: "/tipo/serie/" },
  // POR PAÍSES
  { value: "corea-del-sur", name: "Corea del Sur", path: "/pais/corea-del-sur/" },
  { value: "china", name: "China", path: "/pais/china/" },
  { value: "japon", name: "Japón", path: "/pais/japon/" },
  { value: "tailandia", name: "Tailandia", path: "/pais/tailandia/" },
  { value: "taiwan", name: "Taiwán", path: "/pais/taiwan/" },
  { value: "singapur", name: "Singapur", path: "/pais/singapur/" },
  { value: "filipinas", name: "Filipinas", path: "/pais/filipinas/" },
  { value: "estados-unidos", name: "Estados Unidos", path: "/pais/estados-unidos/" }
];

function filters() {
  var opts = [];
  for (var i = 0; i < SECTIONS.length; i++) {
    opts.push({ value: SECTIONS[i].value, name: SECTIONS[i].name });
  }
  return [{ type: "select", key: "seccion", label: "Sección", options: opts }];
}

function sectionPath(o) {
  var key = o.seccion || o.estado || o.idioma || o.pais || o.tipo || "";
  for (var i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i].value === key) return SECTIONS[i].path;
  }
  return "/tipo/dorama/";
}

// ───────────── Lista / Home ─────────────
function list(page, f) {
  page = page || 1;
  var o = f || {};

  var path = sectionPath(o);

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

    var isTv = href.indexOf("/series/") !== -1 || classes.indexOf("tvshows") !== -1;

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
  var seen = {};
  var re = /<div[^>]*class="[^"]*result-item[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  var m;

  while ((m = re.exec(html)) !== null) {
    var c = m[1];
    var a = /<div[^>]*class="[^"]*title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/.exec(c)
         || /<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/.exec(c);
    if (!a) continue;

    var href = abs(a[1]);
    // Ignorar episodios sueltos (/episodio/...) y la etiqueta "Epidosio"; solo series y películas
    if (href.indexOf("/lista-de-doramas") !== -1) continue;
    if (href.indexOf("/episodio/") !== -1 || href.indexOf("/temporada/") !== -1 ||
        />\s*Ep[ie]+dosio\s*</i.test(c) || />\s*Temporada\s*</.test(c)) continue;
    if (seen[href]) continue;
    seen[href] = true;

    // El primer <img> es la bandera (mx.png); el póster está dentro de div.thumbnail
    var poster = "";
    var th = /<div[^>]*class="[^"]*thumbnail[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(c);
    if (th) {
      var pi = /<img[^>]+(?:data-src|src)="([^"]+)"/.exec(th[1]);
      if (pi) poster = pi[1];
    }
    if (!poster) {
      // Respaldo: primera imagen que no sea bandera/icono
      var ire = /<img[^>]+(?:data-src|src)="([^"]+)"/g, im2;
      while ((im2 = ire.exec(c)) !== null) {
        if (!/\/flags\/|\/uploads\/2024\/05\/|mx\.png/i.test(im2[1])) { poster = im2[1]; break; }
      }
    }
    var img = poster ? [null, poster] : null;
    var isTv = href.indexOf("/series/") !== -1;

    out.push({
      title: clean(a[2]),
      url: href,
      image: abs(img ? img[1] : ""),
      type: isTv ? "serie" : "movie",
      kind: isTv ? "serie" : "movie"
    });
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(pageUrl) {
  var html = getHtml(pageUrl);
  if (!html) return null;

  var m, d = {};

  var isSeries = pageUrl.indexOf("/series/") !== -1;
  d.isSeries = isSeries;

  // Título
  m = /<h1>([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);

  // Sinopsis: el <p> largo dentro de #info (la meta description viene cortada)
  var infoIdx = html.indexOf('id="info"');
  var syn = "";
  if (infoIdx !== -1) {
    m = /<p>([\s\S]{20,}?)<\/p>/.exec(html.substring(infoIdx));
    if (m) syn = clean(m[1].replace(/<[^>]+>/g, " "));
  }
  if (!syn) {
    m = /<meta name="description" content="([^"]+)"/.exec(html);
    if (m) syn = clean(m[1]);
  }
  if (syn) d.synopsis = syn;

  // Año
  m = /<div class="extra">\s*<span>(\d{4})/.exec(html) || /<span>(\d{4})\s*<\/span>/.exec(html);
  if (m) d.year = clean(m[1]);

  m = /<span class="dt_rating_vgs"[^>]*>([^<]+)<\/span>/.exec(html);
  if (m) d.rating = clean(m[1]) + "/10";

  // Géneros (solo del bloque sgeneros)
  var gs = [];
  var gBlock = /<div class="sgeneros">([\s\S]*?)<\/div>/.exec(html);
  if (gBlock) {
    var gre = /<a [^>]*>([^<]+)<\/a>/g;
    while ((m = gre.exec(gBlock[1])) !== null) gs.push(clean(m[1]));
  }
  if (gs.length) d.genres = gs.join(", ");

  d.poster = "";
  d.banner = "";

  if (isSeries) {
    var eps = [];
    var seen = {};

    // Estructura real: <a href=".../episodio/slug-1x1-episodio-1/"><li>...<div class="numerando">1 - 1</div>
    //                  <div class="episodiotitle">Episodio 1<span ...>
    // OJO: algunas series usan comillas simples (href='...', class='numerando'), otras dobles
    var epRegex = /<a[^>]+href=["']([^"']*\/episodio\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/g;
    var me;

    while ((me = epRegex.exec(html)) !== null) {
      var epUrl = abs(me[1]);
      if (seen[epUrl]) continue;
      seen[epUrl] = true;

      var inner = me[2];
      var season = 1, episode = eps.length + 1;

      var num = /<div class=["']numerando["']>\s*(\d+)\s*-\s*(\d+)\s*<\/div>/.exec(inner);
      var fromUrl = /-(\d+)x(\d+)(?:-|\/|$)/.exec(epUrl);
      if (num) {
        season = parseInt(num[1], 10);
        episode = parseInt(num[2], 10);
      } else if (fromUrl) {
        season = parseInt(fromUrl[1], 10);
        episode = parseInt(fromUrl[2], 10);
      }

      var tm = /<div class=["']episodiotitle["']>([^<]*)/.exec(inner);
      var title = tm ? clean(tm[1]) : "";
      if (!title) title = "Episodio " + episode;

      var im = /<img[^>]+src=["']([^"']+)["']/.exec(inner);

      eps.push({
        title: title,
        url: epUrl,
        image: im ? abs(im[1]) : "",
        season: season,
        episode: episode
      });
    }

    d.episodes = eps;
  } else {
    d.episodes = [{ title: "Ver Película", url: pageUrl, image: "" }];
  }

  return d;
}

// ───────────── Servidores ─────────────
function servers(episodeUrl) {
  var html = getHtml(episodeUrl);
  if (!html) return [];

  var out = [];
  var seen = {};

  function push(url, name) {
    url = str(url).replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (!url) return;
    if (seen[url]) return;
    seen[url] = true;
    out.push({ url: abs(url), name: name });
  }

  // Etiqueta <li> completa: los atributos pueden ir con comillas simples o dobles y en cualquier orden
  var re = /(<li\b[^>]*dooplay_player_option[^>]*>)([\s\S]*?)<\/li>/g;
  var m;

  while ((m = re.exec(html)) !== null) {
    var tag = m[1];
    var inner = m[2];

    var post = attr(tag, "data-post");
    var type = attr(tag, "data-type") || "tv";
    var nume = attr(tag, "data-nume");

    if (!post || !nume || nume === "trailer") continue;

    var titleM = /<span class=["']title["']>([^<]+)<\/span>/.exec(inner);
    var serverName = titleM ? clean(titleM[1]) : "Server " + nume;

    var apiUrl = BASE + "/wp-json/dooplayer/v2/" + post + "/" + type + "/" + nume;
    var j = getJson(apiUrl, episodeUrl);
    if (!j) continue;

    var embed = str(j.embed_url);
    if (!embed) continue;

    // Algunos devuelven un <iframe ...> en vez de una URL
    var ifr = /<iframe[^>]+src=["']([^"']+)["']/i.exec(embed);
    if (ifr) embed = ifr[1];
    embed = embed.replace(/\\\//g, "/");

    // Igual que el Kotlin: si la página embed contiene otro iframe, usar ese
    var finalUrl = embed;
    if (embed.indexOf("#") === -1) {
      try {
        var eh = getHtml(abs(embed), episodeUrl);
        var inner2 = eh ? /<iframe[^>]+src=["']([^"']+)["']/i.exec(eh) : null;
        if (inner2) finalUrl = inner2[1];
      } catch (e) { log("Doramas embed error: " + e); }
    }

    push(finalUrl, serverName);
  }

  // Respaldo: iframes directos en la página del episodio
  if (!out.length) {
    var fre = /<iframe[^>]+src=["']([^"']+)["']/gi;
    var n = 1;
    while ((m = fre.exec(html)) !== null) {
      if (/youtube|facebook/i.test(m[1])) continue;
      push(m[1], "Server " + (n++));
    }
  }

  return out;
}
