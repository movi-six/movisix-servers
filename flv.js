/*
 * FLV — AnimeFLV (vww.animeflv.one)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Servidores: POST {base}/flv (acc=opt, i=data-encrypt); cada <li encrypt="HEX"> es la URL del iframe en hexadecimal.
 * ES5. Usa [\s\S] en vez de . con la bandera s.
 */

var BASE = (CONFIG.base || "https://vww.animeflv.one").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function extractSlug(animeUrl) {
  var s = String(animeUrl).replace(BASE + "/anime/", "");
  s = s.replace(/\/+$/, "");
  var q = s.indexOf("?");
  if (q >= 0) s = s.substring(0, q);
  return s;
}

// ───────────── Lista y búsqueda ─────────────
function parseCards(html) {
  var out = [], m;
  var re = /<article class="li">\s*<figure class="i">\s*<a href="\.\/anime\/([^"]+)"[^>]*>\s*<img[^>]+data-src="([^"]+)"[^>]+alt="([^"]*)"[^>]*>\s*<i[^>]*><\/i>\s*<u class="([^"]*)">([^<]*)<\/u>/g;
  while ((m = re.exec(html)) !== null) {
    out.push({ url: BASE + "/anime/" + m[1], image: m[2], title: clean(m[3]), type: clean(m[5]) });
  }
  return out;
}

function list(page) {
  return parseCards(get(BASE + "/animes?pag=" + (page || 1)));
}

function search(query, page) {
  var q = encodeURIComponent(query);
  return parseCards(get(BASE + "/animes?buscar=" + q + "&pag=" + (page || 1)));
}

// ───────────── Detalle + episodios ─────────────
function detail(animeUrl) {
  var html = get(animeUrl);
  var d = {}, m;
  var typeClass = "", typeText = "";

  m = /<h2><i>([^<]+)<\/i>\s*<b[^>]*class="([^"]*)"[^>]*>([^<]*)<\/b>/.exec(html);
  if (m) {
    d.title = clean(m[1]);
    typeClass = m[2].replace(/^\s+|\s+$/g, "");
    typeText = clean(m[3]);
    d.type = typeText;
  }

  var slug = extractSlug(animeUrl);

  // Poster / banner
  m = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (m) { d.poster = m[1]; d.banner = m[1]; }
  if (!d.poster) {
    m = /<figure class="i"><img[^>]+(?:data-src|src)="([^"]+)"/.exec(html);
    if (m) { d.poster = m[1]; d.banner = m[1]; }
  }
  if (!d.poster) {
    d.poster = BASE + "/cdn/img/anime/" + slug + ".webp?t=0.9";
    d.banner = d.poster;
  }

  m = /<div class="tx"><p>([^<]+)<\/p><\/div>/.exec(html);
  if (m) d.synopsis = clean(m[1]);

  m = /<ul class="gn">([\s\S]*?)<\/ul>/.exec(html);
  if (m) {
    var g = [], lm, lre = />([^<]+)<\/a>/g;
    while ((lm = lre.exec(m[1])) !== null) g.push(lm[1].replace(/^\s+|\s+$/g, ""));
    if (g.length) d.genres = g.join(", ");
  }

  m = /<div class="st[^"]*"><span>([^<]+)<\/span>/.exec(html);
  if (m) d.status = m[1].replace(/^\s+|\s+$/g, "");

  d.slug = slug;

  // ¿Película o serie?
  var isMovie = false;
  var tcl = typeClass.toLowerCase(), ttl = typeText.toLowerCase(), sl = slug.toLowerCase();
  if (tcl.indexOf("c-p") >= 0) isMovie = true;
  else if (ttl.indexOf("pelicula") >= 0 || ttl.indexOf("película") >= 0 || ttl.indexOf("movie") >= 0) isMovie = true;
  else if (sl.indexOf("-pelicula") >= 0 || /pelicula$/.test(sl)) isMovie = true;

  d.isSeries = !isMovie;

  var eps;
  if (isMovie) {
    eps = movieEpisode(slug, d);
  } else {
    eps = parseEps(html, slug, d);
    if (!eps.length) { eps = movieEpisode(slug, d); d.isSeries = false; }
  }
  d.episodes = eps;
  return d;
}

function movieEpisode(slug, d) {
  return [{ number: "1", title: "Ver película", url: BASE + "/ver/" + slug + "-1", image: d.poster || "" }];
}

// var eps = [["10","0",""],...]   → [número, tieneImagen(0/1), códigoExtra]
function parseEps(html, slug, d) {
  var out = [];
  var em = /var\s+eps\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (!em) return out;

  var animeId = "", dataAi = "", m;
  m = /data-id="(\d+)"/.exec(html);   if (m) animeId = m[1];
  m = /data-ai="([^"]*)"/.exec(html); if (m) dataAi = m[1];

  var arr;
  try { arr = JSON.parse(em[1]); } catch (e) { log("eps no es JSON: " + e); return out; }

  for (var i = 0; i < arr.length; i++) {
    var ep = arr[i];
    var num = String(ep[0] === undefined || ep[0] === null ? "" : ep[0]);
    var hasI = String(ep[1] === undefined || ep[1] === null ? "0" : ep[1]);
    var cod = String(ep[2] === undefined || ep[2] === null ? "" : ep[2]);
    if (!num) continue;

    var url = BASE + "/ver/" + slug + "-" + num + (cod ? "-" + cod : "");
    var img = null;
    if (hasI === "1" && animeId) img = BASE + "/cdn/img/episodios/" + animeId + "-" + num + ".webp";
    else if (hasI === "1" && !animeId && dataAi) img = BASE + "/cdn/img/episodios/" + dataAi + "-" + num + ".webp";
    if (!img) img = d.poster || "";

    out.push({ number: num, title: "Episodio " + num, url: url, image: img });
  }

  out.sort(function (a, b) {
    var x = parseInt(a.number, 10), y = parseInt(b.number, 10);
    if (isNaN(x) || isNaN(y)) return 0;
    return x - y;
  });
  return out;
}

// ───────────── Servidores de video ─────────────
function hex2a(hex) {
  var s = "";
  for (var i = 0; i + 1 < hex.length; i += 2) {
    var c = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(c)) s += String.fromCharCode(c);
  }
  return s;
}

function sanitize(u) {
  if (!u) return null;
  u = String(u).replace(/^\s+|\s+$/g, "");
  if (!u) return null;
  u = u.replace(/d-s\.io/ig, "doodstream.com")
       .replace(/bysesukior\.com/ig, "filemoon.sx")
       .replace(/movearnpre\.com/ig, "vidhide.com")
       .replace(/luluvdo\.com/ig, "lulustream.com")
       .replace(/dhcplay\.com/ig, "streamwish.to");
  if (/sendvid\.com/i.test(u)) {
    var seg = u.split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (seg) u = "https://sendvid.com/embed/" + seg;
  }
  if (/mxdrop|listeamed|mojon|fembed|videobin|embedv|javascript:/i.test(u)) return null;
  return u;
}

function iframes(html) {
  var out = [], m, re = /<iframe[^>]+src=['"]([^'"]+)['"]/g;
  while ((m = re.exec(html)) !== null) {
    var s = sanitize(m[1]);
    if (s) out.push(s);
  }
  return out;
}

function servers(episodeUrl) {
  var html = get(episodeUrl);
  var dm = /<ul class="opt"[^>]*data-encrypt="([^"]+)"/.exec(html);
  if (!dm) return iframes(html);

  var resp = http.post(BASE + "/flv", "acc=opt&i=" + encodeURIComponent(dm[1]), {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "text/html, */*; q=0.01",
    "Origin": BASE,
    "Referer": episodeUrl
  });
  if (!resp) return iframes(html);

  var out = [], m, re = /<li[^>]+encrypt="([^"]+)"/g;
  while ((m = re.exec(resp)) !== null) {
    var dec = hex2a(m[1]);
    if (dec) {
      var s = sanitize(dec);
      if (s) out.push(s);
    }
  }
  if (!out.length) out = iframes(resp);
  if (!out.length) out = iframes(html);
  return out;
}
