/*
 * Fútbol Libre — canales deportivos en vivo (sitio Astro, HTML estático)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(channelUrl)
 * ES5. El dominio sale SOLO del index.json (CONFIG.base).
 *
 * - Todos los canales están en la portada (#ch-grid): no hay paginación.
 * - El sitio no tiene buscador propio útil: la búsqueda filtra las tarjetas de la portada.
 * - Cada canal tiene su servidor en la misma página: <iframe id="embedIframe" src="...">.
 */

var BASE = String(CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("FutbolLibre: falta \"base\" en el index.json");

function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) { return util.htmlDecode(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }

function abs(u) {
  u = str(u).replace(/^\s+|\s+$/g, "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function norm(s) {
  return str(s).toLowerCase()
    .replace(/[áàäâ]/g, "a").replace(/[éèëê]/g, "e").replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o").replace(/[úùüû]/g, "u").replace(/ñ/g, "n");
}

function attr(tag, name) {
  var m = new RegExp("(?:^|[\\s\"'])" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i").exec(tag || "");
  return m ? m[2] : "";
}

function getHtml(url, referer) {
  var h = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Referer": referer || (BASE + "/")
  };
  var body = http.get(url, h);
  if (!body) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return body;
}

// ───────────── Canales (portada) ─────────────
// <a data-name="espn 1" data-category="Deportes" href="/en-vivo/espn-1"> <img src="/img/channels/espn-1.webp"> <h3>ESPN 1</h3> <p>Deportes en vivo</p> ...</a>
function allChannels() {
  var html = getHtml(BASE + "/");
  var parts = String(html).split(/<a\b(?=[^>]*\bdata-name=)/i), out = [], seen = {};
  for (var i = 1; i < parts.length; i++) {
    var c = parts[i], end = c.indexOf("</a>");
    if (end !== -1) c = c.substring(0, end);
    var open = /^([^>]*)>/.exec(c), tag = open ? open[1] : "";
    var href = attr(tag, "href");
    if (!href || href.indexOf("/en-vivo/") === -1) continue;
    var url = abs(href).replace(/\/+$/, "");
    if (seen[url]) continue;
    seen[url] = true;

    var im = /<img\b[^>]*>/i.exec(c);
    var title = (/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(c) || [])[1] || attr(tag, "data-name");
    out.push({
      title: clean(title),
      url: url,
      image: im ? abs(attr(im[0], "src")) : "",
      type: clean(attr(tag, "data-category")),
      kind: "movie"
    });
  }
  return out;
}

// ───────────── Lista ─────────────
function list(page) {
  if ((page || 1) > 1) return [];
  return allChannels();
}

// ───────────── Búsqueda ─────────────
function search(query, page) {
  if ((page || 1) > 1) return [];
  var words = norm(query).split(/\s+/), all = allChannels(), out = [];
  for (var i = 0; i < all.length; i++) {
    var hay = norm(all[i].title + " " + all[i].type), ok = true;
    for (var j = 0; j < words.length; j++) {
      if (words[j] && hay.indexOf(words[j]) === -1) { ok = false; break; }
    }
    if (ok) out.push(all[i]);
  }
  return out;
}

// ───────────── Detalle ─────────────
function detail(url) {
  var html = getHtml(url, BASE + "/"), m;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: false, episodes: [] };

  // Logo + nombre del canal: <img src="/img/channels/x.webp" alt="Logo de ESPN 1"> junto al <h1>
  // (hay otro "Logo de ..." en la cabecera del sitio, por eso se busca el de /img/channels/)
  var logo = /<img\b[^>]*\/img\/channels\/[^>]*>/i.exec(html);
  if (logo) {
    d.poster = abs(attr(logo[0], "src"));
    d.title = clean(attr(logo[0], "alt").replace(/^Logo de\s+/i, ""));
  }
  if (!d.title) { m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html); if (m) d.title = clean(m[1]).replace(/\s+en vivo.*$/i, ""); }
  d.banner = d.poster;

  m = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html);
  if (m) d.synopsis = clean(m[1]);

  d.genres = "TV en vivo · Deportes";
  d.episodes.push({ title: d.title || "En vivo", url: url, image: d.poster });
  return d;
}

// ───────────── Servidores ─────────────
function hostLabel(u) {
  var m = /^https?:\/\/(?:www\.)?([^\/:?#]+)/i.exec(str(u));
  if (!m) return "Servidor";
  var n = m[1].split(".")[0];
  return n.charAt(0).toUpperCase() + n.substring(1);
}

function servers(channelUrl) {
  var html = getHtml(channelUrl, BASE + "/");
  var tags = html.match(/<iframe\b[^>]*>/gi) || [], out = [], seen = {};
  for (var i = 0; i < tags.length; i++) {
    var src = abs(attr(tags[i], "src") || attr(tags[i], "data-src"));
    if (!src || seen[src]) continue;
    if (/youtube|googletag|doubleclick|facebook|twitter|rtxt\.org|adsterra|highperformance/i.test(src)) continue;
    seen[src] = true;
    out.push({ url: src, name: hostLabel(src), audio: "LAT", referer: channelUrl });
  }
  if (!out.length) log("FutbolLibre: sin iframe del reproductor en " + channelUrl);
  return out;
}
