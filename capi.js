// ───────────── Descifrado CapibaraTraductor ─────────────
// MAGIC extraído de n1.a
var MAGIC = [60, 110, 243, 114];

// LCG de c1.a()
function makeLCG(seed) {
  var s = seed | 0;
  return function next() {
    s = (s + 1831565813) | 0;
    var i2 = Math.imul((s >>> 15) ^ s, s | 1) | 0;
    i2 = (i2 ^ ((Math.imul((i2 >>> 7) ^ i2, i2 | 61) + i2) | 0)) | 0;
    return (i2 ^ (i2 >>> 14)) >>> 24;
  };
}

// Base64 estándar → bytes (array de números 0-255)
function b64ToBytes(b64) {
  var raw = util.base64Decode(b64);          // tu helper; si no existe, usa atob
  var out = [];
  for (var i = 0; i < raw.length; i++) out.push(raw.charCodeAt(i) & 0xFF);
  return out;
}

// Derivar la semilla desde "d"
function deriveSeed(masterBytes) {
  var seed = 0;
  for (var i = 0; i < MAGIC.length; i++) {
    seed = ((seed << 8) | ((masterBytes[i * 2] & 0xFF) ^ MAGIC[i])) | 0;
  }
  return seed;
}

// Descifrar una página
function decryptPage(cipherBytes, seed, index) {
  var key = (Math.imul(-1640531535, index + 1) ^ seed ^ 2135587861) | 0;
  var rng = makeLCG(key);

  var n = cipherBytes.length - 2;
  var out = new Array(n);
  var acc = 90;
  for (var i = 0; i < n; i++) {
    var b = (cipherBytes[i + 2] ^ rng()) & 0xFF;
    acc = ((b * (i + 1)) + acc) & 0xFF;
    out[i] = b;
  }

  // Verificación (checksum)
  var expect = (cipherBytes[1] ^ rng()) & 0xFF;
  if (expect !== acc) throw new Error("Checksum inválido en página " + index);

  // bytes → string UTF-8
  var s = "";
  for (var j = 0; j < out.length; j++) s += String.fromCharCode(out[j]);
  try {
    return decodeURIComponent(escape(s));
  } catch (e) {
    return s;   // fallback si no es UTF-8 estricto
  }
}

// ───────────── Entrada: URLs de páginas de un capítulo ─────────────
// chapterUrl con formato: BASE/{prefix?}/{org}/manga/{slug}/chapters/{capId}
var _pagesCache = {};

function parseChapterUrl(u) {
  var m = /\/([^\/]+)\/manga\/([^\/?#]+)\/chapters\/([^\/?#]+)/.exec(str(u));
  if (!m) throw new Error("URL de capítulo no reconocida: " + u);
  return { org: m[1], slug: m[2], capId: m[3] };
}

function chapterPages(chapterUrl) {
  if (_pagesCache[chapterUrl]) return _pagesCache[chapterUrl];

  var p = parseChapterUrl(chapterUrl);
  var path = "/api/manga-custom/" + encodeURIComponent(p.slug) +
             "/chapter/" + encodeURIComponent(p.capId) + "/pages";

  var j = apiGet(path, p.org);   // reutiliza tu helper; ya envía x-organization
  var payload = j.data || j;

  // La respuesta esperada es { d: "<base64>", a: [ {a:"<base64>"}, ... ] }
  var masterB64 = str(payload.d);
  var items = payload.a || [];
  if (!masterB64 || !items.length) throw new Error("Respuesta de páginas vacía para " + chapterUrl);

  var seed = deriveSeed(b64ToBytes(masterB64));

  var urls = [];
  for (var i = 0; i < items.length; i++) {
    var cipher = b64ToBytes(str(items[i].a));
    urls.push(decryptPage(cipher, seed, i));
  }

  _pagesCache[chapterUrl] = urls;
  return urls;
}

// ───────────── "Servidores" = imágenes directas ─────────────
// Reemplaza el servers() actual. Si falla, cae al servidor-URL original.
function servers(chapterUrl) {
  var urls;
  try {
    urls = chapterPages(chapterUrl);
  } catch (e) {
    log("Capi: fallo descifrando páginas -> " + e.message);
    return [{ url: str(chapterUrl), name: "Leer en CapibaraTraductor", audio: "LAT", referer: BASE + "/" }];
  }

  var srv = [];
  for (var i = 0; i < urls.length; i++) {
    srv.push({
      url: urls[i],
      name: "Página " + (i + 1),
      audio: "LAT",
      referer: BASE + "/",
      headers: { "Referer": BASE + "/", "Origin": BASE }
    });
  }
  return srv;
}
