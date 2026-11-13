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
    if (seen[href]) continue;
    seen[href] = true;

    var img = /<img[^>]+src="([^"]+)"/.exec(c);
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
    var epRegex = /<a[^>]+href="([^"]*\/episodio\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var me;

    while ((me = epRegex.exec(html)) !== null) {
      var epUrl = abs(me[1]);
      if (seen[epUrl]) continue;
      seen[epUrl] = true;

      var inner = me[2];
      var season = 1, episode = eps.length + 1;

      var num = /<div class="numerando">\s*(\d+)\s*-\s*(\d+)\s*<\/div>/.exec(inner);
      var fromUrl = /-(\d+)x(\d+)(?:-|\/|$)/.exec(epUrl);
      if (num) {
        season = parseInt(num[1], 10);
        episode = parseInt(num[2], 10);
      } else if (fromUrl) {
        season = parseInt(fromUrl[1], 10);
        episode = parseInt(fromUrl[2], 10);
      }

      var tm = /<div class="episodiotitle">([^<]*)/.exec(inner);
      var title = tm ? clean(tm[1]) : "";
      if (!title) title = "Episodio " + episode;

      var im = /<img[^>]+src="([^"]+)"/.exec(inner);

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
