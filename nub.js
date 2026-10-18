/*
 * NUB — JavGG (javgg.net) · JAV (HTTP puro, sin WebView)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(detailUrl)
 * ES5.
 */

var BASE = (CONFIG.base || "https://javgg.net").replace(/\/+$/, "");
var UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
];
var JAV = "(https?:\\/\\/[^\"\\/]+\\/jav\\/[^\"]+)";

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }

function get(url) {
  for (var i = 0; i < UAS.length; i++) {
    var h = http.get(url, {
      "User-Agent": UAS[i],
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      "Upgrade-Insecure-Requests": "1",
      "Cache-Control": "max-age=0",
      "Referer": "https://www.google.com/"
    });
    if (h) return h;
    if (http.status() !== 403) break;
  }
  throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
}

function first(html, re) { var m = re.exec(html); return m ? m[1] : null; }

function list(page) {
  page = page || 1;
  var html = get(page === 1 ? BASE + "/new-post/" : BASE + "/new-post/page/" + page + "/");
  var out = [], m;
  var re = new RegExp("<article[^>]+class=\"item movies\"[^>]*>[\\s\\S]*?<img[^>]+src=\"([^\"]+)\"[^>]+title=\"([^\"]+)\"[\\s\\S]*?<div class=\"titlecontent\">([^<]+)<\\/div>[\\s\\S]*?<a href=\"" + JAV + "\"[\\s\\S]*?<h3><a[^>]+>([^<]+)<\\/a><\\/h3>[\\s\\S]*?<span>([^<]+)<\\/span>", "g");
  while ((m = re.exec(html)) !== null) {
    out.push({ image: m[1], title: clean(m[5]), subtitle: trim(m[3]), url: m[4], year: trim(m[6]) });
  }
  if (!out.length) {
    var fb = new RegExp("<img[^>]+src=\"(https?:\\/\\/[^\"\\/]+\\/wp-content\\/uploads\\/[^\"]+)\"[^>]+title=\"([^\"]+)\"[\\s\\S]*?<a href=\"" + JAV + "\"[^>]+title=\"([^\"]+)\">", "g");
    while ((m = fb.exec(html)) !== null) out.push({ image: m[1], title: clean(m[4]), url: m[3] });
  }
  return out;
}

function search(query, page) {
  page = page || 1;
  var q = encodeURIComponent(query);
  var html = get(page === 1 ? BASE + "/?s=" + q : BASE + "/jav/page/" + page + "/?s=" + q);
  var out = [], m;
  var re = new RegExp("<div class=\"thumbnail[^\"]*\">\\s*<a href=\"" + JAV + "\">\\s*<img[^>]+src=\"([^\"]+)\"[^>]+alt=\"([^\"]+)\"", "g");
  while ((m = re.exec(html)) !== null) out.push({ url: m[1], image: m[2], title: clean(m[3]) });
  if (!out.length) {
    var alt = new RegExp("<div class=\"details\">[\\s\\S]*?<a href=\"" + JAV + "\">([^<]+)<\\/a>[\\s\\S]*?<img[^>]+src=\"([^\"]+)\"", "g");
    while ((m = alt.exec(html)) !== null) out.push({ url: m[1], title: clean(m[2]), image: m[3] });
  }
  return out;
}

function attr(tag, name) {
  var m = new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i").exec(tag);
  return m ? trim(m[2]) : null;
}

function sanitize(url) {
  if (!url || !trim(url)) return null;
  url = trim(url);
  if (/bysekoze\.com/i.test(url)) url = url.replace(/bysekoze\.com/ig, "filemoon.sx");
  if (/sendvid\.com/i.test(url)) {
    var seg = url.split("#")[0].split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (seg) url = "https://sendvid.com/embed/" + seg;
  }
  var low = url.toLowerCase(), bad = ["mxdrop", "listeamed", "mojon", "fembed", "videobin", "embedv", "javascript:"];
  for (var i = 0; i < bad.length; i++) if (low.indexOf(bad[i]) >= 0) return null;
  return url;
}

function srcOf(tag) {
  var src = attr(tag, "src");
  if (!src || !trim(src) || trim(src).toLowerCase() === "about:blank") src = attr(tag, "data-src") || attr(tag, "data-lazy-src");
  return src;
}

function extractServers(html) {
  var out = [], tag, s;
  var re = /<iframe\b[^>]*>/ig;
  while ((tag = re.exec(html)) !== null) {
    var cls = attr(tag[0], "class");
    if (!cls || cls.toLowerCase().indexOf("metaframe") < 0) continue;
    s = sanitize(srcOf(tag[0]));
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  if (!out.length) {
    var re2 = /<iframe\b[^>]*>/ig;
    while ((tag = re2.exec(html)) !== null) {
      var src = attr(tag[0], "src");
      if (!src || !trim(src)) src = attr(tag[0], "data-src") || attr(tag[0], "data-lazy-src");
      if (!src) continue;
      var low = src.toLowerCase();
      if (low.indexOf("disqus") >= 0 || low.indexOf("google") >= 0 || low.indexOf("facebook") >= 0 ||
          low.indexOf("twitter") >= 0 || low.indexOf("about:blank") >= 0) continue;
      s = sanitize(src);
      if (s && out.indexOf(s) < 0) out.push(s);
    }
  }
  return out;
}

function detail(url) {
  var html = get(url), m, d = {};
  var title = first(html, /<meta itemprop="name" content="([^"]+)"/);
  if (title) d.title = clean(title);

  var image = first(html, /<img itemprop='image'[^>]+data-lazy-src="([^"]+)"/) ||
              first(html, /<img itemprop='image'[^>]+src='([^']+)'/) ||
              first(html, /<img itemprop='image'[^>]+src="([^"]+)"/);
  if (image) d.poster = image;

  var cast = [], cre = /<div[^>]+id="Cast"[^>]*>\s*<a[^>]+>([^<]+)<\/a>/g;
  while ((m = cre.exec(html)) !== null) cast.push(m[1]);
  if (cast.length) d.cast = cast.join(", ");

  var genres = [], gre = /<a href="https?:\/\/[^"\/]+\/genre\/[^"]+"[^>]*rel="tag">([^<]+)<\/a>/g;
  while ((m = gre.exec(html)) !== null) genres.push(m[1]);
  if (genres.length) d.genres = genres.join(", ");

  var maker = first(html, /<a href="https?:\/\/[^"\/]+\/maker\/[^"]+"[^>]*rel="tag">([^<]+)<\/a>/);
  if (maker) d.maker = maker;
  var date = first(html, /<span class='date'[^>]*>([^<]+)<\/span>/);
  if (date) d.date = trim(date);
  var dur = first(html, /<span itemprop='duration'[^>]*>([^<]+)<\/span>/);
  if (dur) d.duration = trim(dur);

  m = /<div class="content"[^>]*>\s*<p>([\s\S]+?)<\/p>/.exec(html);
  if (m) {
    var syn = clean(m[1]);
    var cut = syn.lastIndexOf("– JavGG.net");
    if (cut > 0) syn = trim(syn.substring(0, cut));
    if (syn.length > 20) d.synopsis = syn;
  }

  d.isSeries = false;
  d.episodes = [{ title: d.title || "Ver", url: url, image: d.poster || "" }];
  return d;
}

function servers(detailUrl) {
  var urls = extractServers(get(detailUrl)), out = [];
  for (var i = 0; i < urls.length; i++) out.push({ url: urls[i], name: "Server " + (i + 1), referer: BASE + "/" });
  return out;
}
