/*
 * Princes — doramasprincess.com (Doramas)        idx 7
 * list · search · detail · servers
 * 100% HTTP. Los reproductores se piden por AJAX (/ajax/get_servers y /ajax/embed) con la cookie de sesión.
 */
var BASE = (CONFIG.base || "https://doramasprincess.com").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}
function abs(u) {
  u = String(u || "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}
function fixImageUrl(url) {
  if (!url) return url;
  var parts = String(url).split("/");
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].indexOf("thumb-") === 0) { parts[i] = parts[i].substring(6); break; }
  }
  return parts.join("/");
}
function kindOf(url) { return url.indexOf("/serie/") >= 0 ? "serie" : "movie"; }

// Bloques <div class="list-movie"> con balanceo de <div>
function splitBlocks(html) {
  var blocks = [], startRe = /<div[^>]*class="list-movie"[^>]*>/g, sm;
  var from = 0;
  while (from < html.length) {
    startRe.lastIndex = from;
    sm = startRe.exec(html);
    if (!sm) break;
    var open = sm.index, pos = sm.index + sm[0].length, depth = 1, bad = false;
    while (pos < html.length && depth > 0) {
      var nO = html.indexOf("<div", pos), nC = html.indexOf("</div>", pos);
      if (nC === -1) { bad = true; break; }
      if (nO !== -1 && nO < nC) { depth++; pos = nO + 4; }
      else { depth--; pos = nC + 6; }
    }
    if (bad) break;
    blocks.push(html.substring(open, pos));
    from = pos;
  }
  return blocks;
}

function cardFields(block) {
  var h = /href="((?:https?:\/\/[^"\/]+)?\/(?:serie|movie)\/[^"]+)"/.exec(block);
  var s = /data-src="([^"]+)"/.exec(block);
  if (!h || !s) return null;
  var t = /class="list-title"[^>]*>([^<]+)<\/a>/.exec(block) || /class="list-titlesub"[^>]*>([^<]+)<\/a>/.exec(block);
  if (!t) return null;
  var url = abs(h[1]);
  return { url: url, image: fixImageUrl(abs(s[1])), title: clean(t[1]), kind: kindOf(url) };
}

function parseList(html) {
  var out = [], blocks = splitBlocks(html);
  for (var i = 0; i < blocks.length; i++) {
    var it = cardFields(blocks[i]);
    if (it) out.push(it);
  }
  if (!out.length) {
    var re = /href="((?:https?:\/\/[^"\/]+)?\/(?:serie|movie)\/[^"]+)"[^>]*>[\s\S]*?data-src="([^"]+)"[\s\S]*?class="list-title"[^>]*>([^<]+)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
      var u = abs(m[1]);
      out.push({ url: u, image: fixImageUrl(abs(m[2])), title: clean(m[3]), kind: kindOf(u) });
    }
  }
  return out;
}

function list(page) {
  page = page || 1;
  return parseList(get(page === 1 ? BASE + "/discovery" : BASE + "/series?page=" + page));
}

function tabBlock(html, id) {
  var sm = new RegExp('<div[^>]*class="[^"]*tab-pane[^"]*"[^>]*id="' + id + '"[^>]*>').exec(html);
  if (!sm) return null;
  var start = sm.index + sm[0].length, pos = start, depth = 1;
  while (pos < html.length && depth > 0) {
    var nO = html.indexOf("<div", pos), nC = html.indexOf("</div>", pos);
    if (nC === -1) break;
    if (nO !== -1 && nO < nC) { depth++; pos = nO + 4; }
    else { depth--; pos = nC + 6; }
  }
  return html.substring(start, pos);
}

function addCards(block, results, seen) {
  var blocks = splitBlocks(block);
  for (var i = 0; i < blocks.length; i++) {
    var it = cardFields(blocks[i]);
    if (it && !seen[it.url]) { seen[it.url] = true; results.push(it); }
  }
}

function search(query, page) {
  if (page && page > 1) return [];
  var html = get(BASE + "/search/" + encodeURIComponent(query));
  var results = [], seen = {};
  var mv = tabBlock(html, "movies");  if (mv) addCards(mv, results, seen);
  var sr = tabBlock(html, "series");  if (sr) addCards(sr, results, seen);
  if (!results.length) addCards(html, results, seen);
  return results;
}

function plain(s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }

function extractSynopsis(html) {
  var m, s;
  m = /<div class="detail-attr">\s*<div class="attr">Descripción general<\/div>\s*<div class="text">\s*<div class="text-content">\s*([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)?[^<]*)/.exec(html);
  if (m) { s = plain(m[1]); if (s.length > 20) return clean(s); }
  m = /<div class="detail-attr">[\s\S]*?Descripción general[\s\S]*?<div class="text-content">([^<]+)/.exec(html);
  if (m) { s = plain(m[1]); if (s.length > 20) return clean(s); }
  m = /<div[^>]*class="[^"]*(?:sinopsis|synopsis|description|descripcion)[^"]*"[^>]*>\s*<p>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)?)/i.exec(html);
  if (m) { s = plain(m[1]); if (s.length > 20) return clean(s); }
  m = /<meta name="description" content="([^"]+)"/.exec(html);
  if (m) { s = plain(m[1]); if (s.length > 20) return clean(s); }
  return "";
}

function detail(pageUrl) {
  var html = get(pageUrl), m;
  var isSerie = pageUrl.indexOf("/serie/") >= 0;
  var d = {};

  m = /<h1>([^<]+)<\/h1>/.exec(html);   if (m) d.title = clean(m[1]);
  m = /<h2>([^<]+)<\/h2>/.exec(html);
  if (m && clean(m[1]) !== d.title) d.subtitle = clean(m[1]);
  m = /<div class="categories">\s*((?:<a[^>]+>[^<]+<\/a>\s*)+)/.exec(html);
  if (m) {
    var gs = [], g, gre = /<a[^>]*>([^<]+)<\/a>/g;
    while ((g = gre.exec(m[1])) !== null) gs.push(clean(g[1]));
    d.genres = gs.join(", ");
  }
  var syn = extractSynopsis(html);                if (syn) d.synopsis = syn;
  m = /<div class="featured-attr">\s*<div class="attr">Fecha de lanzamiento<\/div>\s*<div class="text">(\d{4})<\/div>/.exec(html);
  if (m) d.year = m[1];
  m = /<div class="media media-cover"[^>]*data-src="([^"]+)"/.exec(html);
  if (m) d.poster = fixImageUrl(abs(m[1]));

  if (isSerie) {
    var eps = [], re = /<a href="((?:https?:\/\/[^"\/]+)?\/serie\/[^"]+-season-\d+-episode)"[^>]*>\s*<div class="episode">\s*(\d+)\.Episodio/g;
    while ((m = re.exec(html)) !== null) eps.push({ url: abs(m[1]), title: "Episodio " + m[2], number: m[2], image: "" });
    d.episodes = eps;
    d.isSeries = true;
  } else {
    d.episodes = [{ url: pageUrl, title: "Película Completa", image: "" }];
    d.isSeries = false;
  }
  return d;
}

function guessName(url, i) {
  var m = /^https?:\/\/([^\/]+)/i.exec(url);
  if (!m) return "Server " + i;
  var h = m[1].toLowerCase().replace(/^www\./, "");
  return h.charAt(0).toUpperCase() + h.substring(1);
}

function sanitizeUrl(u) {
  if (!u) return null;
  u = String(u).replace(/^\s+|\s+$/g, "").replace(/\\\//g, "/");
  if (!/^http/i.test(u)) return null;
  var low = u.toLowerCase();
  if (low.indexOf("javascript:") >= 0 || low.indexOf("about:blank") >= 0 ||
      low.indexOf("googletagmanager") >= 0 || low.indexOf("onesignal") >= 0) return null;
  return u;
}

var AJAX = { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01", "Origin": BASE };

function ajaxPost(path, body, referer) {
  var h = { "X-Requested-With": AJAX["X-Requested-With"], "Accept": AJAX["Accept"], "Origin": BASE, "Referer": referer };
  return http.post(BASE + path, body, h);
}

function servers(episodeUrl) {
  var html = get(episodeUrl), m;      // la cookie de sesión queda guardada para los POST siguientes
  var ids = [], seen = {};
  var re = /data-embed="(\d+)"/g;
  while ((m = re.exec(html)) !== null) { if (!seen[m[1]]) { seen[m[1]] = true; ids.push(m[1]); } }

  var sm = /\/serie\/[^\/]+-(\d+)-(\d+)-season-(\d+)-episode/.exec(episodeUrl);
  if (sm) {
    try {
      var resp = ajaxPost("/ajax/get_servers", "_TOKEN=&serie_id=" + encodeURIComponent(sm[1]) +
                          "&season=" + encodeURIComponent(sm[2]) + "&episode=" + encodeURIComponent(sm[3]), episodeUrl);
      var idRe = /"(?:embed|id)"\s*:\s*"(\d+)"/g, im;
      while (resp && (im = idRe.exec(resp)) !== null) { if (!seen[im[1]]) { seen[im[1]] = true; ids.push(im[1]); } }
    } catch (e) { log("get_servers: " + e); }
  }

  var out = [], n = 1, seenUrl = {};
  for (var i = 0; i < ids.length; i++) {
    try {
      var r = ajaxPost("/ajax/embed", "id=" + encodeURIComponent(ids[i]), BASE + "/");
      if (!r) continue;
      r = String(r).replace(/\\"/g, '"').replace(/\\\//g, "/");
      var src = /src=["']([^"']+)["']/.exec(r);
      var u = src ? sanitizeUrl(src[1]) : null;
      if (u && !seenUrl[u]) { seenUrl[u] = true; out.push({ name: guessName(u, n), url: u, referer: episodeUrl }); n++; }
    } catch (e2) { log("embed " + ids[i] + ": " + e2); }
  }
  return out;
}
