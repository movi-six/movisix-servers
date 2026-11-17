var BASE = (CONFIG.base || "").replace(/\/+$/, "");
if (!BASE) throw new Error("NUB: falta CONFIG.base en index.json");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function trim(s) { return String(s || "").replace(/^\s+|\s+$/g, ""); }

function first(html, re) { var m = re.exec(html); return m ? m[1] : null; }

var HTML_JS = "(function(){return document.documentElement.outerHTML;})()";

function fetchHtml(url) {
  var raw = web.eval(url, HTML_JS, { poll: true, timeout: 25000, cache: 300000, stale: 3600000 });
  if (!raw || raw === "null" || raw.length < 1000) {
    throw new Error("WebView no pudo cargar la página: " + url);
  }
  return raw;
}

function parseCards(html) {
  var out = [], m;
  var re = /<article[^>]+class="item movies"[^>]*>[\s\S]*?<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>[\s\S]*?<div class="titlecontent">([^<]+)<\/div>[\s\S]*?<a href="(https?:\/\/[^"\/]+\/jav\/[^"]+)"[\s\S]*?<h3><a[^>]+>([^<]+)<\/a><\/h3>(?:[\s\S]*?<span>([^<]+)<\/span>)?/g;
  while ((m = re.exec(html)) !== null) {
    out.push({
      image: trim(m[1]),
      title: clean(m[2]),
      url: trim(m[3]),
      subtitle: trim(m[4]),
      year: m[5] ? trim(m[5]) : ""
    });
  }
  if (!out.length) {
    var fb = /<img[^>]+(?:src|data-src)="(https?:\/\/[^"\/]+\/wp-content\/uploads\/[^"]+)"[^>]*>[\s\S]*?<div class="titlecontent">([^<]+)<\/div>[\s\S]*?<a href="(https?:\/\/[^"\/]+\/jav\/[^"]+)"/g;
    while ((m = fb.exec(html)) !== null) {
      out.push({ image: trim(m[1]), title: clean(m[2]), url: trim(m[3]) });
    }
  }
  return out;
}

function list(page) {
  page = page || 1;
  var url = page === 1 ? BASE + "/new-post/" : BASE + "/new-post/page/" + page + "/";
  return parseCards(fetchHtml(url));
}

function search(query, page) {
  page = page || 1;
  var q = encodeURIComponent(query);
  var url = page === 1 ? BASE + "/?s=" + q : BASE + "/page/" + page + "/?s=" + q;
  return parseCards(fetchHtml(url));
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

function extractServers(html) {
  var out = [], tag, s;
  var re = /<iframe\b[^>]*>/ig;
  while ((tag = re.exec(html)) !== null) {
    var cls = attr(tag[0], "class");
    if (!cls || cls.toLowerCase().indexOf("metaframe") < 0) continue;
    var src = attr(tag[0], "src");
    if (!src || !trim(src)) src = attr(tag[0], "data-src") || attr(tag[0], "data-lazy-src");
    s = sanitize(src);
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  if (!out.length) {
    var re2 = /<iframe\b[^>]*>/ig;
    while ((tag = re2.exec(html)) !== null) {
      var src2 = attr(tag[0], "src");
      if (!src2 || !trim(src2)) src2 = attr(tag[0], "data-src") || attr(tag[0], "data-lazy-src");
      if (!src2) continue;
      var low = src2.toLowerCase();
      if (low.indexOf("disqus") >= 0 || low.indexOf("google") >= 0 || low.indexOf("facebook") >= 0 ||
          low.indexOf("twitter") >= 0 || low.indexOf("about:blank") >= 0) continue;
      s = sanitize(src2);
      if (s && out.indexOf(s) < 0) out.push(s);
    }
  }
  return out;
}

function detail(url) {
  var html = fetchHtml(url), m, d = {};
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
  var html = fetchHtml(detailUrl);
  var urls = extractServers(html), out = [];
  for (var i = 0; i < urls.length; i++) out.push({ url: urls[i], name: "Server " + (i + 1), referer: BASE + "/" });
  return out;
}
