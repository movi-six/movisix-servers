var BASE = (CONFIG.base || "").replace(/\/+$/, "");

function clean(s) {
    return util.htmlDecode(String(s || ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
}

function abs(u) {
    u = String(u || "");
    if (!u) return "";
    if (/^https?:/i.test(u)) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

function get(url) {
    var h = http.get(url, {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": BASE + "/"
    });
    if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
    return h;
}

function parseCards(html) {
    var out = [];
    if (!html) return out;
    
    var re = /<div class="tray-item movie-card[^"]*">[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    
    while ((m = re.exec(html)) !== null) {
        var url = abs(m[1]);
        var block = m[2];
        
        var titleMatch = /title="([^"]+)"/.exec(block) || /alt="([^"]+)"/.exec(block);
        var title = titleMatch ? clean(titleMatch[1]) : "Sin título";
        
        var imgMatch = /data-src="([^"]+)"/.exec(block) || /src="([^"]+)"/.exec(block);
        var image = imgMatch ? abs(imgMatch[1]) : "";
        
        if (title === "Sin título" && image.indexOf("default-cover") !== -1) continue;

        out.push({
            url: url,
            image: image,
            title: title,
            type: "Película",
            kind: "movie"
        });
    }
    return out;
}

function list(page) {
    page = page || 1;
    var url = BASE + "/jav-uncensored-4qzm2cy8?page=" + page;
    return parseCards(get(url));
}

function search(query, page) {
    page = page || 1;
    var url = BASE + "/search?q=" + encodeURIComponent(query) + "&page=" + page;
    return parseCards(get(url));
}

function detail(pageUrl) {
    var html = get(pageUrl);
    var d = { isSeries: false, episodes: [] };
    
    var titleMatch = /<h1[^>]*class="[^"]*video-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html) || /<title>([^<]+)<\/title>/.exec(html);
    if (titleMatch) d.title = clean(titleMatch[1]).replace(/ - SEXTB\.NET/i, "");
    
    var imgMatch = /<img[^>]*class="[^"]*video-cover[^"]*"[^>]*(?:src|data-src)="([^"]+)"/.exec(html) || /<meta property="og:image" content="([^"]+)"/.exec(html);
    if (imgMatch) d.poster = abs(imgMatch[1]);
    
    var descMatch = /<meta name="description" content="([^"]+)"/.exec(html);
    if (descMatch) d.synopsis = clean(descMatch[1]);
    
    var streamUrl = "";
    var streamMatch = /<source[^>]*src="([^"]+\.m3u8[^"]*)"/.exec(html) || /var\s+videoUrl\s*=\s*["']([^"']+\.m3u8[^"']*)["']/.exec(html) || /data-src="([^"]+\.m3u8[^"]*)"/.exec(html);
    
    if (streamMatch) {
        streamUrl = streamMatch[1].replace(/\\\//g, "/");
    }
    
    d.episodes.push({
        url: pageUrl,
        title: "Ver Video",
        season: "1",
        episode: "1",
        image: d.poster || "",
        _m3u8: streamUrl
    });
    
    return d;
}

function servers(episodeUrl) {
    var html = get(episodeUrl);
    var out = [];
    
    var streamMatch = /<source[^>]*src="([^"]+\.m3u8[^"]*)"/.exec(html) || /var\s+videoUrl\s*=\s*["']([^"']+\.m3u8[^"']*)["']/.exec(html) || /data-src="([^"]+\.m3u8[^"]*)"/.exec(html);
    
    if (streamMatch) {
        var url = streamMatch[1].replace(/\\\//g, "/");
        out.push({
            url: url,
            name: "Directo (HLS)",
            referer: episodeUrl
        });
    } else {
        var iframeMatch = /<iframe[^>]*src="([^"]+)"/.exec(html);
        if (iframeMatch) {
            out.push({
                url: iframeMatch[1],
                name: "Iframe",
                referer: episodeUrl
            });
        }
    }
    
    return out;
}
