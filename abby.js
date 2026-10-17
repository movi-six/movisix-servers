/*
 * Abby — XVideos (xvideos.com)  · contenido adulto
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Cada video es un "anime" con un único episodio; el servidor es la propia URL del video.
 * ES5. Usa [\s\S] en vez de . con la bandera s.
 */

var BASE = (CONFIG.base || "https://www.xvideos.com").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function absUrl(u) {
  u = String(u || "");
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? u : "/" + u);
}

function attr(text, startTag, endTag) {
  var s = text.indexOf(startTag);
  if (s === -1) return null;
  s += startTag.length;
  var e = text.indexOf(endTag, s);
  if (e === -1) return null;
  return text.substring(s, e);
}

function cleanTitle(t) {
  return clean(t).replace(/\d+\s*min$/, "").replace(/^\s+|\s+$/g, "");
}

// ───────────── Lista y búsqueda ─────────────
function list(page) {
  return parseList(get(page <= 1 ? BASE + "/" : BASE + "/new/" + page));
}

function search(query, page) {
  page = page || 1;
  var url = BASE + "/?k=" + encodeURIComponent(query) + (page > 1 ? "&p=" + page : "");
  return parseList(get(url));
}

function parseList(html) {
  var out = [], pos = 0;
  while (true) {
    var bs = html.indexOf("<div id=\"video_", pos);
    if (bs === -1) break;
    var next = html.indexOf("<div id=\"video_", bs + 10);
    var be;
    if (next !== -1) {
      be = next;
    } else {
      be = html.indexOf("</div>", bs + 100);
      if (be === -1) break;
      var ce = html.indexOf("</div>", be + 5);
      if (ce !== -1) be = ce;
    }
    var block = html.substring(bs, be);

    var url = attr(block, "href=\"", "\"");
    if (!url) { pos = be; continue; }

    var img = attr(block, "data-src=\"", "\"") || attr(block, "src=\"", "\"");
    if (!img) { pos = be; continue; }

    var title = null;
    var tm = /<a\s+href="(\/video\.[^"]+)"\s+title="([^"]+)"/i.exec(block);
    if (tm) title = tm[2];
    if (!title) title = attr(block, "title=\"", "\"");
    if (!title) {
      var as = block.indexOf("<a");
      if (as !== -1) {
        var ate = block.indexOf(">", as);
        var ae = ate === -1 ? -1 : block.indexOf("</a>", ate);
        if (ae !== -1) {
          var text = block.substring(ate + 1, ae).replace(/<span[^>]*>[\s\S]*?<\/span>/g, "").replace(/^\s+|\s+$/g, "");
          if (text) title = text;
        }
      }
    }
    if (!title) title = "Video";

    out.push({ url: absUrl(url), image: absUrl(img), title: cleanTitle(title) });
    pos = be;
  }
  return out.length ? out : parseListFallback(html);
}

function parseListFallback(html) {
  var out = [], pos = 0;
  while (true) {
    var us = html.indexOf("<a href=\"/video.", pos);
    if (us === -1) break;
    var hs = us + 9;
    var ue = html.indexOf("\"", hs);
    if (ue === -1) break;
    var url = html.substring(hs, ue);

    var is = html.indexOf("data-src=\"", ue);
    var skip = 9;
    if (is === -1) { is = html.indexOf("src=\"", ue); skip = 5; }
    if (is === -1) { pos = ue + 1; continue; }
    var ias = is + skip;
    var ie = html.indexOf("\"", ias);
    if (ie === -1) { pos = ias + 1; continue; }
    var img = html.substring(ias, ie);

    var title = null;
    var ts = html.indexOf("title=\"", us);
    if (ts !== -1 && ts < ue) {
      ts += 7;
      var te = html.indexOf("\"", ts);
      if (te !== -1) title = html.substring(ts, te);
    }
    if (!title) {
      var ae = html.indexOf("</a>", us);
      var tg = html.indexOf(">", us);
      if (ae !== -1 && tg !== -1 && tg < ae) {
        var tx = html.substring(tg + 1, ae).replace(/<span[^>]*>[\s\S]*?<\/span>/g, "").replace(/^\s+|\s+$/g, "");
        if (tx) title = tx;
      }
    }
    if (!title) title = "Video";

    out.push({ url: absUrl(url), image: absUrl(img), title: cleanTitle(title) });
    pos = ue + 1;
  }
  return out;
}

// ───────────── Detalle (un único episodio) ─────────────
function detail(videoUrl) {
  var html = get(videoUrl);
  var d = {}, m, title = null;

  m = /<h2 class="page-title">[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/.exec(html);
  if (m) title = m[1];
  if (!title) { m = /<meta property="og:title" content="([^"]*)"/.exec(html); if (m) title = m[1]; }
  if (!title) { m = /"name":\s*"([^"]*)"/.exec(html); if (m) title = m[1]; }
  if (title) title = clean(title);

  var tags = [], tre = /<a href="\/tags\/[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = tre.exec(html)) !== null) {
    var t = m[1].replace(/<[^>]*>/g, "").replace(/^\s+|\s+$/g, "");
    if (t) tags.push(t);
    if (tags.length >= 10) break;
  }

  var uploader = null;
  var us = html.indexOf("<li class=\"main-uploader\">");
  if (us !== -1) {
    m = /<span class="name">([\s\S]*?)<\/span>/.exec(html.substring(us));
    if (m) uploader = clean(m[1].replace(/<[^>]*>/g, ""));
  }

  var duration = null;
  m = /<span class="duration">([\s\S]*?)<\/span>/.exec(html);
  if (m) duration = m[1].replace(/^\s+|\s+$/g, "");

  var poster = null;
  m = /<meta property="og:image" content="([^"]*)"/.exec(html);
  if (m) poster = m[1];

  if (title) d.title = title;
  if (tags.length) d.genres = tags.join(", ");
  if (uploader) d.uploader = uploader;
  if (duration) d.duration = duration;
  if (poster) { d.poster = poster; d.banner = poster; }

  d.episodes = [{ title: title || "Ver", url: videoUrl, image: poster || "" }];
  return d;
}

// ───────────── Servidores ─────────────
function servers(episodeUrl) {
  return [episodeUrl];
}
