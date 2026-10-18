/*
 * Flix — doramasflix.co (Doramas, películas y variedades)        idx 12
 * list · search · detail (incluye temporadas/episodios) · servers
 * 100% HTTP. Sitio Next.js: los servidores salen del HTML (initialLinks) o, si no, de la server-action
 * (hash CONFIG.nextAction en index.json: si caduca, se actualiza ahí sin tocar la app).
 */
var BASE = (CONFIG.base || "https://doramasflix.co").replace(/\/+$/, "");
var NEXT_ACTION = CONFIG.nextAction || "40d60c19834e509266631d16b034c59a0095644131";
var UA_MOBILE = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

var SERVER_NAMES = {
  "7286": "Dood", "958695": "Filemoon", "453634": "Mega", "3889": "Mixdrop", "1234": "Mp4Upload",
  "1113": "Ok", "4721": "Primeload", "8309": "Streamtape", "38585": "Streamwish", "1233": "Uqload",
  "576857": "VidHide", "1230": "Voe", "1239": "Streamwish"
};

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function abs(u) {
  u = String(u || "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}
function pageGet(url) {
  var h = http.get(url, { "User-Agent": UA_MOBILE, "Referer": BASE + "/" });
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}
function lastSegment(u) {
  u = String(u).split("?")[0].split("#")[0].replace(/\/+$/, "");
  return u.substring(u.lastIndexOf("/") + 1);
}
function betterPoster(u) { return u ? String(u).replace("/t/p/w154/", "/t/p/w342/") : ""; }
function decodeNextImage(raw) {
  if (!raw) return "";
  var url = String(raw).replace(/&amp;/g, "&");
  if (url.indexOf("/_next/image") >= 0) {
    var i = url.indexOf("url=");
    if (i >= 0) {
      var enc = url.substring(i + 4), a = enc.indexOf("&");
      if (a >= 0) enc = enc.substring(0, a);
      try { return decodeURIComponent(enc); } catch (e) { return enc; }
    }
  }
  if (url.charAt(0) === "/") return BASE + url;
  return url;
}
function unq(html) { return String(html).replace(/\\"/g, '"'); }
function kindOf(url) { return url.indexOf("/peliculas/") >= 0 ? "movie" : "serie"; }

// ── Listas ───────────────────────────────────────────────────
function parseCards(html) {
  var items = [], seen = {}, am;
  var anchorRe = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/g;
  while ((am = anchorRe.exec(html)) !== null) {
    var lm = /aria-label="Ver ([^"]+)"/.exec(am[1]);
    var hm = /href="(\/(?:doramas|peliculas|variedades)\/[^"]+)"/.exec(am[1]);
    if (!lm || !hm) continue;
    var title = clean(lm[1]), href = hm[1];
    if (!title || seen[href]) continue;
    seen[href] = true;
    var image = "", im = /\ssrc="([^"]+)"/.exec(am[2]);
    if (im) image = decodeNextImage(im[1]);
    else { var sm = /srcSet="([^"\s,]+)/.exec(am[2]); if (sm) image = decodeNextImage(sm[1]); }
    items.push({ url: BASE + href, title: title, image: betterPoster(image), year: "", type: "Dorama", rating: "", kind: kindOf(href) });
  }
  return items;
}

function parseFromRsc(html, defSection) {
  var items = [], t = unq(html), seen = {}, m;
  var re = /"name":"([^"]*)","name_es":(?:"[^"]*"|null),"slug":"([^"]+)","isTVShow":(?:true|false)[^{}]*?"first_air_date":(?:"(\d{4})[^"]*"|null)[^{}]*?"poster_path":(?:"([^"]+)"|null)/g;
  while ((m = re.exec(t)) !== null) {
    if (seen[m[2]]) continue;
    seen[m[2]] = true;
    var url = BASE + "/" + defSection + "/" + m[2];
    items.push({ url: url, title: clean(m[1]), image: m[4] ? "https://image.tmdb.org/t/p/w342" + m[4] : "",
                 year: m[3] || "", type: "Dorama", rating: "", kind: kindOf(url) });
  }
  return items;
}

function parseList(html, defSection) {
  var items = parseCards(html);
  if (!items.length) items = parseFromRsc(html, defSection);
  return items;
}

function list(page) {
  if (page && page > 1) return [];
  var html = pageGet(BASE + "/variedades");
  var items = parseList(html, "variedades");
  if (!items.length) throw new Error("0 cards parseadas (HTML de " + html.length + " bytes). ¿Cloudflare o cambio de HTML?");
  return items;
}

function search(query, page) {
  if (page && page > 1) return [];
  return parseList(pageGet(BASE + "/buscar?q=" + encodeURIComponent(query)), "doramas");
}

// ── Detalle ──────────────────────────────────────────────────
function parseDetail(html) {
  var d = { isSeries: true, episodes: [] }, m;
  m = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);                                  if (m) d.title = clean(m[1]);
  m = /<div class="prose[^"]*">\s*<p>([\s\S]*?)<\/p>/i.exec(html);
  if (m) d.synopsis = clean(m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  m = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(html);     if (m) d.poster = m[1];
  m = />(\d{4})</.exec(html);                                              if (m) d.year = m[1];
  return d;
}

function parseSeasons(html, seriesSlug) {
  var out = [], t = unq(html), seen = {}, m;
  var re = /"slug"\s*:\s*"([^"]+)"\s*,\s*"season_number"\s*:\s*(\d+)[^{}]*?"number_of_episodes"\s*:\s*(\d+)/g;
  while ((m = re.exec(t)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = true; out.push({ slug: m[1], number: parseInt(m[2], 10), count: parseInt(m[3], 10) }); }
  }
  if (!out.length) {
    var sm = /"seasons"\s*:\s*\[([\s\S]*?)\]/.exec(t);
    if (sm) {
      var re2 = /"slug"\s*:\s*"([^"]+)"[^{}]*?"season_number"\s*:\s*(\d+)[^{}]*?"number_of_episodes"\s*:\s*(\d+)/g;
      while ((m = re2.exec(sm[1])) !== null) {
        if (!seen[m[1]]) { seen[m[1]] = true; out.push({ slug: m[1], number: parseInt(m[2], 10), count: parseInt(m[3], 10) }); }
      }
    }
  }
  if (!out.length) {
    var re3 = /href="\/temporadas\/([^"\/?#]+)"/g;
    while ((m = re3.exec(t)) !== null) {
      if (seen[m[1]]) continue;
      seen[m[1]] = true;
      var n = /-(\d+)$/.exec(m[1]);
      out.push({ slug: m[1], number: n ? parseInt(n[1], 10) : out.length + 1, count: 0 });
    }
  }
  if (!out.length) {
    var c = /"number_of_episodes"\s*:\s*(\d+)/.exec(t);
    out.push({ slug: seriesSlug + "-1", number: 1, count: c ? parseInt(c[1], 10) : 0 });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function newEpisode(slug, season, ep, multi, title, image) {
  if (!title || !String(title).replace(/\s/g, "")) title = multi ? "T" + season + " - Episodio " + ep : "Episodio " + ep;
  return { url: BASE + "/capitulos/" + slug, title: title, image: image || "", season: String(season), number: String(ep) };
}

// found: { orden: [slugs], map: {slug: ep} }  (conserva el orden de inserción)
function put(found, slug, ep) { if (!found.map[slug]) { found.order.push(slug); found.map[slug] = ep; } }

function parseEpisodeAnchors(html, season, multi, found) {
  if (!html) return;
  var am, re = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/g;
  while ((am = re.exec(html)) !== null) {
    var hm = /href="\/capitulos\/([^"\/?#]+)"/.exec(am[1]);
    if (!hm) continue;
    var slug = hm[1];
    if (found.map[slug]) continue;
    var s = season.number, n = found.order.length + 1, nm = /-(\d+)x(\d+)$/.exec(slug);
    if (nm) { s = parseInt(nm[1], 10); n = parseInt(nm[2], 10); }
    var title = null, lm = /aria-label="([^"]+)"/.exec(am[1]);
    if (lm) {
      var l = clean(lm[1]);
      if (l.toLowerCase() !== "ver" && l.toLowerCase().indexOf("ver temporada") !== 0) title = l.replace(/^ver\s+/i, "");
    }
    var image = "", im = /\ssrc="([^"]+)"/.exec(am[2]);
    if (im) image = betterPoster(decodeNextImage(im[1]));
    put(found, slug, newEpisode(slug, s, n, multi, title, image));
  }
}

function parseEpisodesFromRsc(html, seriesSlug, season, multi, found) {
  if (!html) return;
  var t = unq(html), m, re = new RegExp('"slug":"(' + esc(seriesSlug) + '-(\\d+)x(\\d+))"', "g");
  while ((m = re.exec(t)) !== null) put(found, m[1], newEpisode(m[1], parseInt(m[2], 10), parseInt(m[3], 10), multi, null, ""));
}

function fetchEpisodes(pageUrl, detailHtml) {
  var seriesSlug = lastSegment(pageUrl);
  var seasons = parseSeasons(detailHtml, seriesSlug), multi = seasons.length > 1, i;
  var om = /"number_of_episodes_online"\s*:\s*(\d+)/.exec(detailHtml);
  var online = om ? parseInt(om[1], 10) : -1;
  var found = { order: [], map: {} };

  for (i = 0; i < seasons.length; i++) parseEpisodeAnchors(detailHtml, seasons[i], multi, found);
  for (i = 0; i < seasons.length; i++) {
    try {
      var sh = pageGet(BASE + "/temporadas/" + seasons[i].slug), before = found.order.length;
      parseEpisodeAnchors(sh, seasons[i], multi, found);
      if (found.order.length === before) parseEpisodesFromRsc(sh, seriesSlug, seasons[i], multi, found);
    } catch (e) { log("temporada " + seasons[i].slug + ": " + e); }
  }
  if (!found.order.length && online > 0) {
    for (i = 0; i < seasons.length; i++) {
      var s = seasons[i], count = (s.count > 0 && s.count < online) ? s.count : online;
      for (var k = 1; k <= count; k++) {
        var slug = seriesSlug + "-" + s.number + "x" + k;
        put(found, slug, newEpisode(slug, s.number, k, multi, null, ""));
      }
    }
  }
  var all = [];
  for (i = 0; i < found.order.length; i++) all.push(found.map[found.order[i]]);
  all.sort(function (a, b) {
    var sa = parseInt(a.season, 10), sb = parseInt(b.season, 10);
    if (sa !== sb) return sa - sb;
    return parseInt(a.number, 10) - parseInt(b.number, 10);
  });
  if (online > 0 && all.length > online) all = all.slice(0, online);
  return all;
}

function detail(pageUrl) {
  pageUrl = abs(pageUrl);
  var html = pageGet(pageUrl);
  var d = parseDetail(html);
  if (pageUrl.indexOf("/peliculas/") >= 0) {
    d.isSeries = false;
    d.episodes = [{ url: pageUrl, title: d.title || "Ver", image: d.poster || "" }];
    return d;
  }
  try { d.episodes = fetchEpisodes(pageUrl, html); } catch (e) { log("fetchEpisodes: " + e); }
  return d;
}

// ── Servidores ───────────────────────────────────────────────
function b64urlDecode(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return util.b64decode(s);
}

function decodeJwt(jwt) {
  var parts = String(jwt).split(".");
  if (parts.length !== 3) return null;
  var p = JSON.parse(b64urlDecode(parts[1]));
  if (!p.link || !p.server) return null;
  var code = String(p.server);
  return { name: SERVER_NAMES[code] || ("Server-" + code), url: util.b64decode(String(p.link)), code: code };
}

function extractInitialLinks(html) {
  var out = [], t = unq(html), start = t.indexOf('"initialLinks":[');
  if (start < 0) return out;
  var arrStart = t.indexOf("[", start), depth = 0, arrEnd = -1;
  for (var i = arrStart; i < t.length; i++) {
    var c = t.charAt(i);
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd < 0) return out;
  var arr = t.substring(arrStart, arrEnd + 1), seen = {}, m;
  var re = /"server"\s*:\s*"([^"]+)"[^{}]*?"link"\s*:\s*"([^"]+)"/g;
  while ((m = re.exec(arr)) !== null) {
    if (seen[m[1]]) continue;
    seen[m[1]] = true;
    var jwt = m[2].substring(m[2].lastIndexOf("/") + 1);
    try { var info = decodeJwt(jwt); if (info) out.push(info); } catch (e) { log("JWT initialLinks: " + e); }
  }
  return out;
}

function extractContentId(html, pageUrl) {
  var t = unq(html), slug = esc(lastSegment(pageUrl)), m;
  if (pageUrl.indexOf("/capitulos/") >= 0) {
    m = /"episode"\s*:\s*\{\s*"_id"\s*:\s*"([a-f0-9]{24})"/.exec(t);
    if (m) return m[1];
  }
  m = new RegExp('"_id"\\s*:\\s*"([a-f0-9]{24})"[^{}]{0,5000}?"slug"\\s*:\\s*"' + slug + '"').exec(t);
  if (m) return m[1];
  m = new RegExp('"slug"\\s*:\\s*"' + slug + '"[^{}]{0,5000}?"_id"\\s*:\\s*"([a-f0-9]{24})"').exec(t);
  if (m) return m[1];
  var tm = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
  if (tm) {
    m = new RegExp('"_id"\\s*:\\s*"([a-f0-9]{24})"[^{}]{0,5000}?"name"\\s*:\\s*"' + esc(tm[1].replace(/^\s+|\s+$/g, "")) + '"').exec(t);
    if (m) return m[1];
  }
  m = /"_id"\s*:\s*"([a-f0-9]{24})"[^{}]{0,2000}?"(?:isTVShow|poster_path|number_of_seasons|number_of_episodes)"/.exec(t);
  if (m) return m[1];
  if (pageUrl.indexOf("/capitulos/") >= 0) {
    m = /"_id"\s*:\s*"([a-f0-9]{24})"/.exec(t);
    if (m) return m[1];
  }
  return null;
}

function routerStateTree(pageUrl) {
  var secs = ["peliculas", "capitulos", "variedades", "doramas"];
  for (var i = 0; i < secs.length; i++) {
    if (pageUrl.indexOf("/" + secs[i] + "/") >= 0) {
      var raw = '["",{"children":[["locale","es","d",null],{"children":["' + secs[i] + '",{"children":[["slug","' + lastSegment(pageUrl) +
                '","d",null],{"children":["__PAGE__",{}]}]}]},null,null,0]},null,null,16]';
      return encodeURIComponent(raw);
    }
  }
  return "%5B%22%22%2C%7B%22children%22%3A%5B%5B%22locale%22%2C%22es%22%2C%22d%22%2Cnull%5D%2C%7B%7D%5D%7D%5D";
}

function parseRsc(rsc) {
  var out = [], tokens = [], seen = {}, m;
  var re = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
  while ((m = re.exec(rsc)) !== null) if (!seen[m[0]]) { seen[m[0]] = true; tokens.push(m[0]); }
  var codes = {};
  for (var i = 0; i < tokens.length; i++) {
    try {
      var info = decodeJwt(tokens[i]);
      if (info && !codes[info.code]) { codes[info.code] = true; out.push(info); }
    } catch (e) { log("JWT: " + e); }
  }
  return out;
}

function servers(pageUrl) {
  pageUrl = abs(pageUrl);
  var html = pageGet(pageUrl), list = extractInitialLinks(html), i;
  if (!list.length) {
    var id = extractContentId(html, pageUrl);
    if (!id) throw new Error("No se pudo extraer movie_id de " + pageUrl + " (ni initialLinks ni movie_id)");
    var resp = http.post(pageUrl, '[{"movie_id":"' + id + '"}]', {
      "User-Agent": UA_MOBILE,
      "Accept": "text/x-component",
      "Accept-Language": "es-ES,es;q=0.9",
      "Content-Type": "text/plain;charset=UTF-8",
      "next-action": NEXT_ACTION,
      "next-router-state-tree": routerStateTree(pageUrl),
      "Origin": BASE,
      "Referer": pageUrl
    });
    if (!resp) throw new Error("HTTP " + http.status() + " — el hash 'next-action' caducó. Actualiza \"nextAction\" en index.json (flix)");
    list = parseRsc(resp);
  }
  for (i = 0; i < list.length; i++) list[i].referer = pageUrl;
  return list;
}
