/*
 * Tv — tvporinternet.org (Canales de TV en vivo)        idx 9
 * list · search · detail · servers
 * 100% HTTP. servers() devuelve la propia página del canal como único "servidor" (ver canal).
 */
var BASE = (CONFIG.base || "https://www.tvporinternet.org").replace(/\/+$/, "");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }
function abs(u) {
  u = String(u || "");
  if (!u) return "";
  if (/^https?:/i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function channels() {
  var html = http.get(BASE);
  if (!html) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + BASE);
  var out = [], m;
  var re = /<a\s+class="channel"\s+href="([^"]+)"[\s\S]*?>[\s\S]*?<img\s+src="([^"]+)"[\s\S]*?>[\s\S]*?<div\s+class="channel-name">\s*([^<]+?)\s*<\/div>/gi;
  while ((m = re.exec(html)) !== null) {
    var url = abs(m[1]), title = clean(m[3]);
    if (url.indexOf("/redes/") >= 0 || title.toLowerCase() === "mundo latam") continue;
    out.push({ url: url, image: abs(m[2]), title: title, type: "Canal TV", kind: "movie" });
  }
  return out;
}

function list(page) {
  if (page && page > 1) return [];       // todos los canales vienen en la página principal
  return channels();
}

function search(query, page) {
  if (page && page > 1) return [];
  var all = channels();
  var q = String(query || "").toLowerCase().replace(/^\s+|\s+$/g, "");
  if (!q) return all;
  var out = [];
  for (var i = 0; i < all.length; i++) if (all[i].title.toLowerCase().indexOf(q) >= 0) out.push(all[i]);
  return out;
}

function playServer(url) { return [{ name: "Ver Canal", url: url }]; }

function defaultDetail(url) {
  return {
    title: "Canal de TV", poster: "", banner: "", synopsis: "Disfruta de este canal en vivo 24/7",
    servers: playServer(url), episodes: [{ url: url, title: "Ver Canal", image: "" }], isSeries: false
  };
}

function detail(url) {
  var html = "";
  try { html = http.get(url); } catch (e) { html = ""; }
  if (!html) return defaultDetail(url);

  var m = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
  var title = m ? clean(m[1]) : "Canal de TV";
  m = /<div[^>]*class="info-logo"[^>]*>\s*<img\s+src="([^"]+)"[^>]*>/i.exec(html);
  var image = m ? abs(m[1]) : "";

  var desc = "";
  var info = /<div[^>]*class="info-card"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(html);
  if (info) {
    var parts = [], p, pre = /<p>([\s\S]*?)<\/p>/g;
    while ((p = pre.exec(info[1])) !== null) {
      var t = clean(p[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "));
      if (t) parts.push(t);
    }
    desc = parts.join("\n\n");
  }
  if (!desc) desc = "Disfruta de este canal en vivo las 24 horas del día en excelente calidad HD.";

  return {
    title: title, poster: image, banner: image, synopsis: desc,
    servers: playServer(url), episodes: [{ url: url, title: "Ver Canal", image: image }], isSeries: false
  };
}

function servers(channelUrl) { return playServer(channelUrl); }
