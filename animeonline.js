var BASE = (CONFIG.base || "").replace(/\/+$/, "");

function str(v) { return (v === undefined || v === null) ? "" : String(v); }
function clean(s) { return util.htmlDecode(str(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }
function cap(s) { s = str(s); return s ? s.charAt(0).toUpperCase() + s.substring(1) : s; }

function abs(u) {
  u = str(u).replace(/^\s+|\s+$/g, "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function bigImg(u) { return abs(u).replace(/-\d+x\d+\./, "."); }

function attr(tag, name) {
  var m = new RegExp("(?:^|[\\s\"'])" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i").exec(tag || "");
  return m ? m[2] : "";
}

function imgOf(html) {
  var m = /<img\b[^>]*>/i.exec(html || "");
  if (!m) return "";
  return attr(m[0], "data-src") || attr(m[0], "data-lazy-src") || attr(m[0], "src");
}

function chunksByClass(html, classes) {
  html = str(html);
  var re = /<(article|div|li)\b[^>]*\bclass\s*=\s*["']([^"']*)["'][^>]*>/gi, idx = [], m;
  while ((m = re.exec(html)) !== null) {
    var have = " " + m[2].replace(/\s+/g, " ") + " ", ok = true;
    for (var i = 0; i < classes.length; i++) if (have.indexOf(" " + classes[i] + " ") === -1) { ok = false; break; }
    if (ok) idx.push(m.index);
  }
  var out = [];
  for (var k = 0; k < idx.length; k++) out.push(html.substring(idx[k], k + 1 < idx.length ? idx[k + 1] : html.length));
  return out;
}

function sliceDiv(html, startRe) {
  html = str(html);
  var m = startRe.exec(html);
  if (!m) return "";
  var from = m.index + m[0].length, depth = 1, re = /<(\/?)div\b/gi, t;
  re.lastIndex = from;
  while ((t = re.exec(html)) !== null) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.substring(from, t.index);
  }
  return html.substring(from);
}

function kindOf(url) { return /\/(pelicula|peliculas|movies?)\//i.test(url) ? "movie" : "serie"; }

function getHtml(url, referer) {
  var h = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1"
  };
  if (referer) h["Referer"] = referer;
  var body = http.get(url, h);
  if (!body) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return body;
}

function getEmbedHtml(url, referer) {
  var h = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
  };
  if (referer) h["Referer"] = referer;
  var body = http.get(url, h);
  if (!body) throw new Error("Sin respuesta embed (HTTP " + http.status() + ") de " + url);
  return body;
}

function list(page) {
  page = page || 1;
  var url = BASE + "/online/" + (page > 1 ? "page/" + page + "/" : "");
  var html = getHtml(url, BASE + "/");
  var area = sliceDiv(html, /<div[^>]*\bid=["']archive-content["'][^>]*>/i);
  if (!area) { log("AnimeOnline: no se encontró #archive-content en " + url); return []; }
  var out = [], seen = {}, cards = chunksByClass(area, ["item", "tvshows"]);
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var a = /<h3[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(c);
    if (!a) continue;
    var u = abs(a[1]);
    if (seen[u]) continue;
    seen[u] = true;
    var r = /class=["']rating["'][^>]*>[\s\S]*?<\/span>\s*([0-9]+(?:\.[0-9]+)?)/i.exec(c);
    var y = /class=["']metadata["'][^>]*>[\s\S]*?<span>\s*(\d{4})\s*<\/span>/i.exec(c);
    out.push({ title: clean(a[2]), url: u, image: bigImg(imgOf(c)), rating: r ? r[1] : "", year: y ? y[1] : "", kind: kindOf(u) });
  }
  return out;
}

function search(query, page) {
  page = page || 1;
  var url = BASE + "/search/" + (page > 1 ? "page/" + page + "/" : "") + "?s=" + encodeURIComponent(query);
  var html = getHtml(url, BASE + "/");
  var out = [], seen = {}, cards = chunksByClass(html, ["result-item"]);
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var a = /class=["'][^"']*\btitle\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(c);
    if (!a) continue;
    var u = abs(a[1]);
    if (seen[u]) continue;
    seen[u] = true;
    var y = /class=["'][^"']*\byear\b[^"']*["'][^>]*>([^<]*)</i.exec(c);
    out.push({ title: clean(a[2]), url: u, image: bigImg(imgOf(c)), year: y ? clean(y[1]) : "", kind: kindOf(u) });
  }
  return out;
}

function detail(url) {
  var html = getHtml(url, BASE + "/"), m;
  var d = { title: "", synopsis: "", genres: "", poster: "", banner: "", year: "", rating: "", director: "", isSeries: false, seasons: [], episodes: [] };

  m = /<div[^>]*class=["'][^"']*\bdata\b[^"']*["'][^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (m) d.title = clean(m[1]);

  m = /<div[^>]*class=["'][^"']*\bposter\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (m) d.poster = bigImg(imgOf(m[1]));

  m = /class=["'][^"']*\bsgeneros\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (m) {
    var g = [], re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi, x;
    while ((x = re.exec(m[1])) !== null) { var t = clean(x[1]); if (t && g.indexOf(t) === -1) g.push(t); }
    d.genres = g.join(", ");
  }

  m = /<div[^>]*class=["'][^"']*\bwp-content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html) ||
      /<div[^>]*class=["'][^"']*\bdescription\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = /class=["'][^"']*\bdate\b[^"']*["'][^>]*>[^<]*?(\d{4})/i.exec(html);
  if (m) d.year = m[1];

  var blocks = chunksByClass(html, ["se-c"]);
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var tm = /class=["'][^"']*\bse-q\b[^"']*["'][^>]*>[\s\S]*?class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(b) ||
             /class=["'][^"']*\bse-t\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(b);
    var stitle = tm ? clean(tm[1].split("<")[0]) : ("Temporada " + (i + 1));
    var eps = [], seenEp = {};
    var ul = /<ul\b[^>]*class=["'][^"']*\bepisodios\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(b);
    var lis = ul ? ul[1].split(/<li\b/i) : [];
    for (var j = 1; j < lis.length; j++) {
      var li = lis[j];
      var a = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(li);
      if (!a) continue;
      var eu = abs(a[1]);
      if (seenEp[eu]) continue;
      seenEp[eu] = true;
      eps.push({ title: clean(a[2]) || ("Episodio " + j), url: eu, image: bigImg(imgOf(li)) });
    }
    if (eps.length) {
      d.seasons.push({ title: stitle, episodes: eps });
      for (var k = 0; k < eps.length; k++) d.episodes.push(eps[k]);
    }
  }

  d.isSeries = d.seasons.length > 0;
  if (!d.isSeries) {
    d.seasons = [];
    d.episodes = [{ title: "Película", url: url, image: d.poster }];
  }
  return d;
}

function findPlayerIframe(html, episodeUrl) {
  var tags = str(html).match(/<iframe\b[^>]*>/gi) || [];
  var i, src;
  for (i = 0; i < tags.length; i++) {
    if (/metaframe/i.test(attr(tags[i], "class"))) {
      src = attr(tags[i], "src") || attr(tags[i], "data-src");
      if (src) return abs(src);
    }
  }

  var optRe = /<li\b[^>]*dooplay_player_option[^>]*>/gi, o;
  while ((o = optRe.exec(html)) !== null) {
    var post = attr(o[0], "data-post"),
        nume = attr(o[0], "data-nume"),
        type = attr(o[0], "data-type") || "tv";
    if (!post || !nume) continue;

    try {
      var r = http.post(
        BASE + "/wp-admin/admin-ajax.php",
        "action=doo_player_ajax&post=" + encodeURIComponent(post) +
        "&nume=" + encodeURIComponent(nume) +
        "&type=" + encodeURIComponent(type),
        {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": episodeUrl,
          "Origin": BASE
        }
      );
      var j = JSON.parse(r || "{}");
      var e = j.embed_url || j.embed || "";
      var mm = /src=["']([^"']+)["']/i.exec(e);
      if (mm) return abs(mm[1]);
      if (/^https?:/i.test(e)) return e;
    } catch (err) { log("AnimeOnline ajax error: " + err); }
  }
  return "";
}

function hostName(u) {
  var m = /^https?:\/\/(?:www\.)?([^\/:?#]+)/i.exec(str(u));
  return m ? cap(m[1].split(".")[0]) : "Servidor";
}

function servers(episodeUrl) {
  var html = getHtml(episodeUrl, BASE + "/");
  var iframe = findPlayerIframe(html, episodeUrl);
  if (!iframe) { log("AnimeOnline: no se encontró el iframe en " + episodeUrl); return []; }
  log("AnimeOnline: iframe → " + iframe);

  var ih = getEmbedHtml(iframe, episodeUrl);
  log("AnimeOnline embed len=" + ih.length + " gtp=" + /go_to_player/i.test(ih));

  var out = [], seen = {};
  var re = /go_to_player\(\s*['"]([^'"]+)['"]\s*\)/gi, x;
  while ((x = re.exec(ih)) !== null) {
    var u = x[1];
    if (seen[u]) continue;
    seen[u] = true;

    var tail = ih.substring(x.index, x.index + 500);
    var pm = /<p>\s*([^<]+?)\s*<\/p>/i.exec(tail);
    var desc = pm ? clean(pm[1]) : "";
    var low = desc.toLowerCase();
    var audio = "SUB";
    if (/audio\s*latino|latino/.test(low)) audio = "LAT";
    else if (/castellano|español\s*\(españa\)/.test(low)) audio = "CAS";
    else if (/audio\s*ingl|english/.test(low)) audio = "ENG";

    var nm = /<span>\s*([^<]+?)\s*<\/span>/i.exec(tail);
    out.push({
      url: u,
      name: nm ? clean(nm[1]) : hostName(u),
      audio: audio,
      referer: iframe
    });
  }

  if (out.length === 0) {
    var re2 = /<iframe\b[^>]*src=["']([^"']+)["']/gi, x2;
    while ((x2 = re2.exec(ih)) !== null) {
      if (seen[x2[1]]) continue;
      seen[x2[1]] = true;
      out.push({ url: x2[1], name: hostName(x2[1]), audio: "SUB", referer: iframe });
    }
  }

  if (out.length === 0) log("AnimeOnline: sin servidores. head=" + str(ih).substring(0, 400).replace(/\s+/g, " "));
  return out;
}
