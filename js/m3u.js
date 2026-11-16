(function (root) {
    "use strict";

    function decodeEntities(value) {
        if (!value) {
            return value;
        }
        return value
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/ᵁᴴᴰ/g, "UHD")
            .replace(/ᴴᴰ/g, "HD")
            .replace(/ˢᴰ/g, "SD")
            .replace(/[\u1d00-\u1edf\u2000-\u2bff]/g, "")
            .trim();;
    }

    function parseAttributes(line) {
        var attrs = {};
        var rest = line;
        var header = /^#EXTINF:\s*(-?[0-9]*\.?[0-9]*)\s*(.*)$/i.exec(line);
        if (header) {
            rest = header[2] || "";
        }

        var name = "";
        var inQuote = false;
        var cutoff = -1;
        var i;
        for (i = 0; i < rest.length; i++) {
            var ch = rest.charAt(i);
            if (ch === '"') {
                inQuote = !inQuote;
            } else if (ch === "," && !inQuote) {
                cutoff = i;
                break;
            }
        }

        if (cutoff >= 0) {
            name = rest.substring(cutoff + 1).replace(/^\s+/, "");
            rest = rest.substring(0, cutoff);
        }

        var attrRe = /([A-Za-z0-9_-]+)\s*=\s*("[^"]*"|[^\s]+)/g;
        var match;
        while ((match = attrRe.exec(rest)) !== null) {
            var key = match[1].toLowerCase();
            var value = match[2];
            if (value.charAt(0) === '"') {
                value = value.substring(1, value.length - 1);
            }
            attrs[key] = decodeEntities(value);
        }

        return { attrs: attrs, name: decodeEntities(name) };
    }

    function parse(text) {
        var channels = [];
        var lines = String(text || "").split(/\r?\n/);
        var pending = null;
        var pendingGroup = "";
        var i;

        for (i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/^\s+|\s+$/g, "");
            if (!line) {
                continue;
            }

            if (line.indexOf("#EXTM3U") === 0) {
                continue;
            }

            if (line.indexOf("#EXTINF") === 0) {
                pending = parseAttributes(line);
                pendingGroup = "";
                continue;
            }

            if (line.indexOf("#EXTGRP:") === 0) {
                pendingGroup = decodeEntities(line.substring(8).replace(/^\s+/, ""));
                continue;
            }

            if (line.charAt(0) === "#") {
                continue;
            }

            if (pending) {
                var attrs = pending.attrs;
                channels.push({
                    id: attrs["tvg-id"] || "",
                    name: pending.name || attrs["tvg-name"] || "Channel",
                    logo: attrs["tvg-logo"] || "",
                    group: attrs["group-title"] || pendingGroup || "Uncategorized",
                    number: attrs["tvg-chno"] || "",
                    url: line
                });
                pending = null;
                pendingGroup = "";
            }
        }

        var groupMap = {};
        var groups = [];
        for (i = 0; i < channels.length; i++) {
            var groupName = channels[i].group;
            if (!groupMap[groupName]) {
                groupMap[groupName] = { name: groupName, count: 0 };
                groups.push(groupMap[groupName]);
            }
            groupMap[groupName].count += 1;
        }

        return { channels: channels, groups: groups };
    }

    var api = { parse: parse, parseAttributes: parseAttributes };
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.M3U = api;
    }
})(typeof window !== "undefined" ? window : this);
