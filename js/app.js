(function () {
    "use strict";

    var CONFIG = {
        playlistUrl: "http://192.168.1.60:9191/output/m3u?output_format=m3u8",
        logoBase: "http://192.168.1.60/logos/",
        requestTimeoutMs: 20000
    };

    var FAVORITES_KEY = "iptv.favorites.v1";
    var VIEW_KEY = "iptv.view.v1";

    var widgetAPI = null;
    var tvKey = null;
    try {
        if (typeof Common !== "undefined" && Common.API) {
            if (Common.API.Widget) {
                widgetAPI = new Common.API.Widget();
            }
            if (Common.API.TVKeyValue) {
                tvKey = new Common.API.TVKeyValue();
            }
        }
    } catch (e) {
        widgetAPI = null;
        tvKey = null;
    }

    var FALLBACK_KEYS = {
        LEFT: 4,
        RIGHT: 5,
        UP: 29460,
        DOWN: 29461,
        ENTER: 13,
        RETURN: 88,
        EXIT: 45,
        PLAY: 71,
        PAUSE: 74,
        CHUP: 427,
        CHDOWN: 428,
        RED: 403,
        GREEN: 404,
        YELLOW: 405,
        BLUE: 406,
        INFO: 457,
        VOL_UP: 447,
        VOL_DOWN: 448,
        MUTE: 449
    };

    var IS_TV = !!tvKey;

    var KEY = {};
    (function () {
        var names = [
            "LEFT", "RIGHT", "UP", "DOWN", "ENTER", "RETURN", "EXIT",
            "PLAY", "PAUSE", "CHUP", "CHDOWN", "RED", "GREEN", "YELLOW",
            "BLUE", "INFO", "VOL_UP", "VOL_DOWN", "MUTE"
        ];
        var aliases = {
            VOL_UP: "KEY_VOLUME_UP",
            VOL_DOWN: "KEY_VOLUME_DOWN",
            CHUP: "KEY_CH_UP",
            CHDOWN: "KEY_CH_DOWN"
        };
        var i;
        for (i = 0; i < names.length; i++) {
            var name = names[i];
            var platformValue = tvKey ? tvKey["KEY_" + name] : null;
            if (typeof platformValue !== "number" && tvKey && aliases[name]) {
                platformValue = tvKey[aliases[name]];
            }
            KEY[name] = typeof platformValue === "number" ? platformValue : FALLBACK_KEYS[name];
        }
    })();

    var els = {};
    var player = null;
    var favorites = {};
    var logosBroken = true;
    var logoFailed = {};
    var logoProbeId = 0;
    var overlayTimer = null;
    var libraryTimer = null;
    var volumeTimer = null;
    var toastTimer = null;

    var state = {
        screen: "loading",
        channels: [],
        rawGroups: [],
        groups: [],
        filter: "all",
        filtered: [],
        pane: "channels",
        selectedGroup: 0,
        selectedChannel: 0,
        currentChannel: null,
        currentKey: null,
        preferRaw: false,
        view: "list",
        gridColumns: 5,
        gridRows: 3,
        listRendered: false,
        renderedFilter: null,
        renderedView: null,
        renderedTotal: -1,
        renderedWindowSize: -1,
        groupWindowStart: 0,
        channelWindowStart: 0,
        groupWindowSize: 14,
        channelWindowSize: 9
    };

    function $(id) {
        return document.getElementById(id);
    }

    function setText(el, text) {
        if (el) {
            el.textContent = text;
        }
    }

    function esc(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function initialOf(name) {
        var text = String(name || "");
        var i;
        for (i = 0; i < text.length; i++) {
            if (/[A-Za-z0-9\u0600-\u06FF]/.test(text.charAt(i))) {
                return text.charAt(i);
            }
        }
        return "?";
    }

    function channelKey(channel) {
        return channel.id ? "id:" + channel.id : "url:" + channel.url;
    }

    function rawStreamUrl(url) {
        if (url.indexOf("?output_format=m3u8") >= 0) {
            return url.replace("?output_format=m3u8", "");
        }
        return null;
    }

    function playUrlFor(channel) {
        if (state.preferRaw) {
            return rawStreamUrl(channel.url) || channel.url;
        }
        return channel.url;
    }

    function loadView() {
        try {
            var value = window.localStorage.getItem(VIEW_KEY);
            if (value === "grid" || value === "list") {
                state.view = value;
            }
        } catch (e) {
            /* storage unavailable */
        }
    }

    function saveView() {
        try {
            window.localStorage.setItem(VIEW_KEY, state.view);
        } catch (e) {
            /* storage unavailable */
        }
    }

    function toggleView() {
        state.view = state.view === "grid" ? "list" : "grid";
        saveView();
        state.channelWindowStart = 0;
        computeWindowSizes();
        renderChannels();
    }

    function toggleFormat() {
        state.preferRaw = !state.preferRaw;
        if (state.currentChannel) {
            playChannel(state.currentChannel);
        }
        showToast(state.preferRaw ? "Stream: MPEG-TS" : "Stream: HLS");
    }

    /* ---------- Favorites ---------- */

    function loadFavorites() {
        try {
            var raw = window.localStorage.getItem(FAVORITES_KEY);
            if (!raw) {
                return;
            }
            var list = JSON.parse(raw);
            var i;
            for (i = 0; i < list.length; i++) {
                favorites[list[i]] = true;
            }
        } catch (e) {
            /* storage unavailable */
        }
    }

    function saveFavorites() {
        try {
            var list = [];
            var key;
            for (key in favorites) {
                if (favorites.hasOwnProperty(key)) {
                    list.push(key);
                }
            }
            window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
        } catch (e) {
            /* storage unavailable */
        }
    }

    function isFavorite(channel) {
        return !!favorites[channelKey(channel)];
    }

    function favoriteCount() {
        var count = 0;
        var i;
        for (i = 0; i < state.channels.length; i++) {
            if (isFavorite(state.channels[i])) {
                count += 1;
            }
        }
        return count;
    }

    function toggleFavorite(target) {
        var channel = target || state.filtered[state.selectedChannel];
        if (!channel) {
            return;
        }
        var key = channelKey(channel);
        var wasFavorite = !!favorites[key];
        if (wasFavorite) {
            delete favorites[key];
        } else {
            favorites[key] = true;
        }
        saveFavorites();
        state.groups[1].count = favoriteCount();
        rebuildFiltered();
        renderGroups();
        renderChannels(true);
        showToast(wasFavorite ? "Removed from favorites" : "Added to favorites");
    }

    /* ---------- Data / filtering ---------- */

    function buildGroups() {
        var list = [];
        list.push({ name: "All channels", filter: "all", count: state.channels.length });
        list.push({ name: "\u2605 Favorites", filter: "fav", count: favoriteCount() });
        var i;
        for (i = 0; i < state.rawGroups.length; i++) {
            list.push({
                name: state.rawGroups[i].name,
                filter: state.rawGroups[i].name,
                count: state.rawGroups[i].count
            });
        }
        state.groups = list;
    }

    function rebuildFiltered() {
        var out = [];
        var i;
        if (state.filter === "all") {
            out = state.channels.slice(0);
        } else if (state.filter === "fav") {
            for (i = 0; i < state.channels.length; i++) {
                if (isFavorite(state.channels[i])) {
                    out.push(state.channels[i]);
                }
            }
        } else {
            for (i = 0; i < state.channels.length; i++) {
                if (state.channels[i].group === state.filter) {
                    out.push(state.channels[i]);
                }
            }
        }
        state.filtered = out;
        if (state.selectedChannel >= out.length) {
            state.selectedChannel = out.length > 0 ? out.length - 1 : 0;
        }
    }

    /* ---------- Windowing ---------- */

    function scrollWindow(selected, total, size, previousStart) {
        if (total <= size) {
            return 0;
        }
        var maxStart = total - size;
        var start = previousStart;
        if (start < 0) {
            start = 0;
        }
        if (start > maxStart) {
            start = maxStart;
        }
        if (selected < start) {
            start = selected;
        } else if (selected >= start + size) {
            start = selected - size + 1;
        }
        if (start < 0) {
            start = 0;
        }
        if (start > maxStart) {
            start = maxStart;
        }
        return start;
    }

    function scrollGridWindow(selected, total, columns, rows, previousStart) {
        var size = columns * rows;
        if (total <= size) {
            return 0;
        }
        var maxStart = total - size;
        var start = previousStart;
        if (start < 0) {
            start = 0;
        }
        if (start > maxStart) {
            start = maxStart;
        }
        if (selected < start) {
            start = selected;
        } else if (selected >= start + size) {
            start = selected - size + 1;
        }
        start = start - (start % columns);
        if (start < 0) {
            start = 0;
        }
        if (start > maxStart) {
            start = maxStart - (maxStart % columns);
            if (start < 0) {
                start = 0;
            }
        }
        return start;
    }

    function computeWindowSizes() {
        var groupHeight = els.groupList ? els.groupList.clientHeight : 0;
        if (groupHeight > 0) {
            state.groupWindowSize = Math.max(3, Math.floor(groupHeight / 38));
        }

        if (!els.channelList) {
            return;
        }

        if (state.view === "grid") {
            var listWidth = els.channelList.clientWidth || 900;
            var listHeight = els.channelList.clientHeight || 540;
            state.gridColumns = Math.max(1, Math.floor((listWidth - 24) / 148));
            state.gridRows = Math.max(1, Math.floor((listHeight - 16) / 148));
            state.channelWindowSize = state.gridColumns * state.gridRows;
            return;
        }

        var channelHeight = els.channelList.clientHeight;
        if (channelHeight > 0) {
            state.channelWindowSize = Math.max(3, Math.floor(channelHeight / 60));
        }
    }

    /* ---------- Rendering ---------- */

    function renderGroups() {
        var total = state.groups.length;
        if (!els.groupList || !total) {
            return;
        }
        state.groupWindowStart = scrollWindow(
            state.selectedGroup,
            total,
            state.groupWindowSize,
            state.groupWindowStart
        );

        var start = state.groupWindowStart;
        var end = Math.min(total, start + state.groupWindowSize);
        var focused = state.pane === "groups";
        var html = [];
        var i;

        for (i = start; i < end; i++) {
            var group = state.groups[i];
            var cls = "grp-row";
            if (i === state.selectedGroup) {
                cls += focused ? " selected" : " selected-dim";
            }
            html.push(
                '<li class="' + cls + '">' +
                    '<span class="grp-name">' + esc(group.name) + '</span>' +
                    '<span class="grp-count">' + group.count + "</span>" +
                "</li>"
            );
        }

        els.groupList.innerHTML = html.join("");
    }

    var LOGO_COLORS = [
        "#3a2a5e", "#1f4a5e", "#5e2a3a", "#2a5e3f",
        "#5e4a1f", "#2a3f5e", "#4a2a2a", "#1f5e5a"
    ];

    function channelColor(channel) {
        var text = String(channel.name || "");
        var hash = 0;
        var i;
        for (i = 0; i < text.length; i++) {
            hash = (hash * 31 + text.charCodeAt(i)) & 0x7fffffff;
        }
        return LOGO_COLORS[hash % LOGO_COLORS.length];
    }

    function logoInnerHtml(channel) {
        var key = channelKey(channel);
        var html = '<span class="ch-initial">' + esc(initialOf(channel.name)) + "</span>";
        if (channel.logo && !logosBroken && !logoFailed[key]) {
            html += '<img src="' + esc(channel.logo) + '" alt="" data-id="' +
                esc(channel.id || "") + '" data-key="' + esc(key) +
                '" onerror="logoFallback(this)">';
        }
        return html;
    }

    function channelLogoHtml(channel) {
        return '<span class="ch-logo" style="background:' + channelColor(channel) + '">' +
            logoInnerHtml(channel) + "</span>";
    }

    function channelCardLogoHtml(channel) {
        return '<span class="ch-card-logo" style="background:' + channelColor(channel) + '">' +
            logoInnerHtml(channel) + "</span>";
    }

    function logoFallback(img) {
        var id = img.getAttribute("data-id");
        var key = img.getAttribute("data-key");
        if (id && !img.getAttribute("data-tried")) {
            img.setAttribute("data-tried", "1");
            img.src = CONFIG.logoBase + encodeURIComponent(id) + ".png";
        } else {
            if (key) {
                logoFailed[key] = true;
            }
            img.style.display = "none";
        }
    }

    function probeLogos(channels) {
        if (typeof Image === "undefined") {
            return;
        }
        var sample = null;
        var i;
        for (i = 0; i < channels.length && i < 30; i++) {
            if (channels[i].logo) {
                sample = channels[i];
                break;
            }
        }
        if (!sample) {
            return;
        }

        var probeId = ++logoProbeId;
        var probe = new Image();
        probe.onload = function () {
            if (probeId !== logoProbeId) {
                return;
            }
            logosBroken = false;
            renderChannels(true);
        };
        probe.onerror = function () {
            if (probeId !== logoProbeId) {
                return;
            }
            logosBroken = true;
        };
        probe.src = sample.logo;
    }

    window.logoFallback = logoFallback;

    function updateChannelSelection() {
        var total = state.filtered.length;
        var rows = els.channelList.getElementsByTagName("li");
        var focused = state.pane === "channels";
        var baseClass = state.view === "grid" ? "ch-card" : "ch-row";
        var i;

        for (i = 0; i < rows.length; i++) {
            var row = rows[i];
            var index = parseInt(row.getAttribute("data-index"), 10);
            if (isNaN(index)) {
                continue;
            }
            var cls = baseClass;
            if (index === state.selectedChannel) {
                cls += focused ? " selected" : " selected-dim";
            }
            var channel = state.filtered[index];
            if (channel && state.currentKey && channelKey(channel) === state.currentKey) {
                cls += " playing";
            }
            row.className = cls;
        }
        setText(els.channelPos, (state.selectedChannel + 1) + " / " + total);
    }

    function renderChannels(force) {
        var total = state.filtered.length;
        if (!els.channelList) {
            return;
        }

        els.channelList.className = state.view === "grid" ? "channel-list grid" : "channel-list";

        if (!total) {
            state.listRendered = false;
            els.channelList.innerHTML = '<li class="empty">No channels in this category</li>';
            setText(els.channelPos, "0 / 0");
            return;
        }

        var prevStart = state.channelWindowStart;
        var windowSize = state.view === "grid"
            ? state.gridColumns * state.gridRows
            : state.channelWindowSize;
        var newStart;

        if (state.view === "grid") {
            newStart = scrollGridWindow(
                state.selectedChannel,
                total,
                state.gridColumns,
                state.gridRows,
                prevStart
            );
        } else {
            newStart = scrollWindow(
                state.selectedChannel,
                total,
                state.channelWindowSize,
                prevStart
            );
        }

        if (!force && state.listRendered &&
                newStart === prevStart &&
                state.renderedFilter === state.filter &&
                state.renderedView === state.view &&
                state.renderedTotal === total &&
                state.renderedWindowSize === windowSize) {
            updateChannelSelection();
            return;
        }

        state.channelWindowStart = newStart;

        var focused = state.pane === "channels";
        var html = [];
        var end;
        var i;

        if (state.view === "grid") {
            end = Math.min(total, newStart + windowSize);
            for (i = newStart; i < end; i++) {
                var cardChannel = state.filtered[i];
                var cardClass = "ch-card";
                if (i === state.selectedChannel) {
                    cardClass += focused ? " selected" : " selected-dim";
                }
                if (state.currentKey && state.currentKey === channelKey(cardChannel)) {
                    cardClass += " playing";
                }
                html.push(
                    '<li class="' + cardClass + '" data-index="' + i + '">' +
                        channelCardLogoHtml(cardChannel) +
                        '<span class="ch-card-name">' + esc(cardChannel.name) + "</span>" +
                        '<span class="ch-card-num">' + esc(cardChannel.number || String(i + 1)) + "</span>" +
                        (isFavorite(cardChannel) ? '<span class="ch-card-fav">\u2605</span>' : "") +
                    "</li>"
                );
            }
        } else {
            end = Math.min(total, newStart + windowSize);
            for (i = newStart; i < end; i++) {
                var channel = state.filtered[i];
                var cls = "ch-row";
                if (i === state.selectedChannel) {
                    cls += focused ? " selected" : " selected-dim";
                }
                if (state.currentKey && state.currentKey === channelKey(channel)) {
                    cls += " playing";
                }
                html.push(
                    '<li class="' + cls + '" data-index="' + i + '">' +
                        '<span class="ch-num">' + esc(channel.number || String(i + 1)) + "</span>" +
                        channelLogoHtml(channel) +
                        '<span class="ch-text">' +
                            '<span class="ch-name">' + esc(channel.name) + "</span>" +
                            '<span class="ch-group">' + esc(channel.group) + "</span>" +
                        "</span>" +
                        (isFavorite(channel) ? '<span class="ch-fav">\u2605</span>' : "") +
                    "</li>"
                );
            }
        }

        els.channelList.innerHTML = html.join("");
        state.renderedFilter = state.filter;
        state.renderedView = state.view;
        state.renderedTotal = total;
        state.renderedWindowSize = windowSize;
        state.listRendered = true;
        setText(els.channelPos, (state.selectedChannel + 1) + " / " + total);
    }

    function renderAll() {
        renderGroups();
        renderChannels();
    }

    /* ---------- Screens ---------- */

    function showScreen(name) {
        state.screen = name;
        els.loading.className = name === "loading" ? "screen" : "screen hidden";
        els.browser.className = name === "browser"
            ? "screen"
            : (name === "library" ? "screen library-overlay" : "screen hidden");
        els.player.className = (name === "player" || name === "library")
            ? "screen"
            : "screen hidden";
    }

    function setLoadingMessage(message, isError) {
        setText(els.loadingText, message);
        if (els.loadingText) {
            els.loadingText.className = isError ? "loading-text error" : "loading-text";
        }
        if (els.loadingBox) {
            els.loadingBox.className = isError ? "loading-box has-error" : "loading-box";
        }
    }

    /* ---------- Loading ---------- */

    function handlePlaylistError(message) {
        showScreen("loading");
        setLoadingMessage(message, true);
        setText(els.loadingHint, "BLUE: retry    RETURN: exit");
    }

    function handlePlaylistText(text) {
        setLoadingMessage("Parsing playlist\u2026", false);

        var parsed;
        try {
            parsed = window.M3U.parse(text);
        } catch (e) {
            handlePlaylistError("Could not parse the playlist");
            return;
        }

        if (!parsed.channels.length) {
            handlePlaylistError("Playlist is empty or invalid");
            return;
        }

        state.channels = parsed.channels;
        state.rawGroups = parsed.groups;
        state.filter = "all";
        state.selectedGroup = 0;
        state.selectedChannel = 0;
        state.currentKey = null;
        state.groupWindowStart = 0;
        state.channelWindowStart = 0;
        state.listRendered = false;
        logosBroken = true;
        logoFailed = {};

        buildGroups();
        rebuildFiltered();

        setText(
            els.statusLine,
            parsed.channels.length + " channels \u00b7 " + parsed.groups.length + " categories"
        );
        setText(els.groupTitle, "All channels");

        showScreen("browser");
        computeWindowSizes();
        renderAll();
        probeLogos(state.channels);
    }

    function fetchPlaylist() {
        showScreen("loading");
        setLoadingMessage("Fetching playlist\u2026", false);
        setText(els.loadingHint, "Press RETURN to exit");

        var xhr = new XMLHttpRequest();
        var finished = false;

        function fail(message) {
            if (finished) {
                return;
            }
            finished = true;
            handlePlaylistError(message);
        }

        function succeed(text) {
            if (finished) {
                return;
            }
            finished = true;
            handlePlaylistText(text);
        }

        try {
            xhr.open("GET", CONFIG.playlistUrl, true);
            if (xhr.overrideMimeType) {
                xhr.overrideMimeType("text/plain; charset=utf-8");
            }
            xhr.timeout = CONFIG.requestTimeoutMs;
        } catch (e) {
            fail("Unable to open the playlist request");
            return;
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) {
                return;
            }
            if (xhr.status === 200) {
                succeed(xhr.responseText);
            } else if (xhr.status === 0 && xhr.responseText) {
                succeed(xhr.responseText);
            } else {
                fail("Playlist request failed (HTTP " + xhr.status + ")");
            }
        };
        xhr.ontimeout = function () {
            fail("Playlist request timed out");
        };
        xhr.onerror = function () {
            fail("Network error reaching Dispatcharr");
        };

        try {
            xhr.send();
        } catch (e) {
            fail("Unable to send the playlist request");
        }
    }

    /* ---------- TV helpers (volume, on-screen messages) ---------- */

    function showToast(message) {
        if (!els.toast) {
            return;
        }
        els.toast.textContent = message;
        els.toast.className = "toast";
        if (toastTimer) {
            clearTimeout(toastTimer);
        }
        toastTimer = setTimeout(function () {
            els.toast.className = "toast hidden";
        }, 2200);
    }

    function showVolume(volume, muted) {
        if (!els.volumeBox) {
            return;
        }
        setText(els.volumeLabel, muted ? "MUTE" : (volume === null ? "VOL" : "VOL " + volume));
        var percent = (muted || volume === null) ? 0 : Math.max(0, Math.min(100, volume));
        if (els.volumeFill) {
            els.volumeFill.style.width = Math.round(2.04 * percent) + "px";
        }
        els.volumeBox.className = "volume-box";
        if (volumeTimer) {
            clearTimeout(volumeTimer);
        }
        volumeTimer = setTimeout(function () {
            els.volumeBox.className = "volume-box hidden";
        }, 2500);
    }

    function handleVolume(action) {
        var audio = els.audioPlugin;
        var volume = null;
        var muted = false;
        try {
            if (audio) {
                if (action === "MUTE") {
                    muted = !(audio.GetUserMute() === true || audio.GetUserMute() === 1);
                    if (audio.SetUserMute) {
                        audio.SetUserMute(muted);
                    }
                } else {
                    if (audio.GetUserMute &&
                            (audio.GetUserMute() === true || audio.GetUserMute() === 1)) {
                        if (audio.SetUserMute) {
                            audio.SetUserMute(false);
                        }
                    }
                    if (audio.SetVolumeWithKey) {
                        audio.SetVolumeWithKey(action === "VOL_UP" ? 0 : 1);
                    } else if (audio.SetVolume) {
                        var current = audio.GetVolume ? audio.GetVolume() : 50;
                        audio.SetVolume(Math.max(0, Math.min(100,
                            current + (action === "VOL_UP" ? 2 : -2))));
                    }
                }
                if (audio.GetVolume) {
                    volume = audio.GetVolume();
                }
                if (action === "MUTE" && audio.GetUserMute) {
                    muted = audio.GetUserMute() === true || audio.GetUserMute() === 1;
                }
            }
        } catch (e) {
            /* audio plugin unavailable */
        }
        showVolume(volume, muted);
    }

    function initTvPlugins() {
        if (!IS_TV) {
            return;
        }

        var pluginAPI = null;
        try {
            if (typeof Common !== "undefined" && Common.API && Common.API.Plugin) {
                pluginAPI = new Common.API.Plugin();
            }
        } catch (e) {
            pluginAPI = null;
        }

        var volumeKeys = [];
        if (tvKey) {
            var volUp = typeof tvKey.KEY_VOL_UP === "number"
                ? tvKey.KEY_VOL_UP
                : tvKey.KEY_VOLUME_UP;
            var volDown = typeof tvKey.KEY_VOL_DOWN === "number"
                ? tvKey.KEY_VOL_DOWN
                : tvKey.KEY_VOLUME_DOWN;
            var volMute = tvKey.KEY_MUTE;
            if (typeof volUp === "number") {
                volumeKeys.push(volUp);
            }
            if (typeof volDown === "number") {
                volumeKeys.push(volDown);
            }
            if (typeof volMute === "number") {
                volumeKeys.push(volMute);
            }
        }

        var i;
        for (i = 0; i < volumeKeys.length; i++) {
            try {
                if (pluginAPI) {
                    pluginAPI.unregistKey(volumeKeys[i]);
                }
            } catch (e) {
                /* ignore */
            }
            try {
                if (els.tvmw && els.tvmw.UnregisterKey) {
                    els.tvmw.UnregisterKey(volumeKeys[i]);
                }
            } catch (e) {
                /* ignore */
            }
        }
        try {
            if (els.nnavi && els.nnavi.SetBannerState) {
                els.nnavi.SetBannerState(1);
            }
        } catch (e) {
            /* ignore */
        }
    }

    /* ---------- Player ---------- */

    function showOverlay(show) {
        if (!els.overlay) {
            return;
        }
        els.overlay.className = show ? "player-overlay" : "player-overlay hidden";
        if (overlayTimer) {
            clearTimeout(overlayTimer);
            overlayTimer = null;
        }
        if (show) {
            overlayTimer = setTimeout(function () {
                showOverlay(false);
            }, 5000);
        }
    }

    function toggleOverlay() {
        var hidden = els.overlay.className.indexOf("hidden") >= 0;
        showOverlay(hidden);
    }

    function playChannel(channel) {
        if (!channel) {
            return;
        }
        state.currentChannel = channel;
        state.currentKey = channelKey(channel);
        setText(els.nowName, channel.name);
        setText(els.nowGroup, channel.group);

        showScreen("player");
        showOverlay(true);

        player.play(
            playUrlFor(channel),
            state.preferRaw ? null : rawStreamUrl(channel.url)
        );
    }

    function stopPlayback() {
        player.stop();
        state.currentKey = null;
        state.currentChannel = null;
        if (overlayTimer) {
            clearTimeout(overlayTimer);
            overlayTimer = null;
        }
        if (libraryTimer) {
            clearTimeout(libraryTimer);
            libraryTimer = null;
        }
        showScreen("browser");
        state.pane = "channels";
        computeWindowSizes();
        renderAll();
    }

    function switchChannel(delta) {
        var total = state.filtered.length;
        if (!total) {
            return;
        }
        state.selectedChannel = (state.selectedChannel + delta + total) % total;
        state.currentKey = channelKey(state.filtered[state.selectedChannel]);
        renderChannels();
        playChannel(state.filtered[state.selectedChannel]);
    }

    function togglePlayback() {
        var paused = player.togglePause();
        showToast(paused ? "Paused" : "Playing");
        showOverlay(true);
    }

    function findChannelIndex(list, channel) {
        var key = channelKey(channel);
        var i;
        for (i = 0; i < list.length; i++) {
            if (channelKey(list[i]) === key) {
                return i;
            }
        }
        return -1;
    }

    function resetLibraryTimer() {
        if (libraryTimer) {
            clearTimeout(libraryTimer);
            libraryTimer = null;
        }
        if (state.screen === "library") {
            libraryTimer = setTimeout(function () {
                closeLibraryOverlay();
            }, 20000);
        }
    }

    function openLibraryOverlay() {
        if (state.screen !== "player") {
            return;
        }
        if (state.currentChannel) {
            var index = findChannelIndex(state.filtered, state.currentChannel);
            if (index >= 0) {
                state.selectedChannel = index;
            }
        }
        state.pane = "channels";
        showScreen("library");
        showOverlay(false);
        computeWindowSizes();
        renderAll();
        resetLibraryTimer();
    }

    function closeLibraryOverlay() {
        if (libraryTimer) {
            clearTimeout(libraryTimer);
            libraryTimer = null;
        }
        showScreen("player");
    }

    /* ---------- Navigation ---------- */

    function selectGroupByIndex(index) {
        state.selectedGroup = index;
        var group = state.groups[index];
        if (group) {
            state.filter = group.filter;
            state.selectedChannel = 0;
            state.channelWindowStart = 0;
            setText(els.groupTitle, group.name);
            rebuildFiltered();
            renderChannels();
        }
        renderGroups();
    }

    function moveGroup(delta) {
        var total = state.groups.length;
        if (!total) {
            return;
        }
        var next = (state.selectedGroup + delta + total) % total;
        selectGroupByIndex(next);
    }

    function moveChannel(delta) {
        var total = state.filtered.length;
        if (!total) {
            return;
        }
        state.selectedChannel = (state.selectedChannel + delta + total) % total;
        renderChannels();
    }

    function moveGrid(dx, dy) {
        var total = state.filtered.length;
        if (!total) {
            return;
        }
        var columns = state.gridColumns || 1;
        var index = state.selectedChannel;

        if (dy) {
            var rowTarget = index + dy * columns;
            if (rowTarget >= 0 && rowTarget < total) {
                state.selectedChannel = rowTarget;
                renderChannels();
            }
            return;
        }

        if (dx < 0) {
            if (index % columns === 0) {
                focusGroups();
                return;
            }
            state.selectedChannel = index - 1;
            renderChannels();
        } else if (dx > 0) {
            if (index % columns === columns - 1 || index + 1 >= total) {
                return;
            }
            state.selectedChannel = index + 1;
            renderChannels();
        }
    }

    function focusGroups() {
        state.pane = "groups";
        renderGroups();
        renderChannels();
    }

    function focusChannels() {
        state.pane = "channels";
        renderGroups();
        renderChannels();
    }

    function activateSelection() {
        if (state.pane === "groups") {
            focusChannels();
            return;
        }
        var channel = state.filtered[state.selectedChannel];
        if (!channel) {
            return;
        }
        if (state.screen === "library" && state.currentChannel &&
                channelKey(state.currentChannel) === channelKey(channel)) {
            closeLibraryOverlay();
            return;
        }
        playChannel(channel);
    }

    /* ---------- Exit ---------- */

    function exitApp() {
        if (player) {
            player.stop();
        }
        if (widgetAPI) {
            if (typeof widgetAPI.sendExitEvent === "function") {
                widgetAPI.sendExitEvent();
            } else if (typeof widgetAPI.sendReturnEvent === "function") {
                widgetAPI.sendReturnEvent();
            }
        }
    }

    function goBackFromBrowser() {
        if (state.pane === "groups") {
            focusChannels();
        } else {
            exitApp();
        }
    }

    /* ---------- Key handling ---------- */

    function handleLoadingKey(code) {
        if (code === KEY.BLUE) {
            fetchPlaylist();
            return true;
        }
        if (code === KEY.RETURN || code === KEY.EXIT) {
            exitApp();
            return true;
        }
        return false;
    }

    function handleBrowserKey(code) {
        var inLibrary = state.screen === "library";

        if (code === KEY.LEFT) {
            if (state.pane === "groups") {
                return true;
            }
            if (state.view === "grid") {
                moveGrid(-1, 0);
            } else {
                focusGroups();
            }
            return true;
        }
        if (code === KEY.RIGHT) {
            if (state.pane === "groups") {
                focusChannels();
            } else if (state.view === "grid") {
                moveGrid(1, 0);
            }
            return true;
        }
        if (code === KEY.UP) {
            if (state.pane === "groups") {
                moveGroup(-1);
            } else if (state.view === "grid") {
                moveGrid(0, -1);
            } else {
                moveChannel(-1);
            }
            return true;
        }
        if (code === KEY.DOWN) {
            if (state.pane === "groups") {
                moveGroup(1);
            } else if (state.view === "grid") {
                moveGrid(0, 1);
            } else {
                moveChannel(1);
            }
            return true;
        }
        if (code === KEY.CHUP) {
            moveChannel(-1);
            return true;
        }
        if (code === KEY.CHDOWN) {
            moveChannel(1);
            return true;
        }
        if (code === KEY.ENTER) {
            activateSelection();
            return true;
        }
        if (code === KEY.RED) {
            toggleView();
            return true;
        }
        if (code === KEY.GREEN) {
            toggleFavorite();
            return true;
        }
        if (code === KEY.BLUE) {
            fetchPlaylist();
            return true;
        }
        if (code === KEY.RETURN) {
            if (inLibrary) {
                closeLibraryOverlay();
            } else {
                goBackFromBrowser();
            }
            return true;
        }
        if (code === KEY.EXIT) {
            exitApp();
            return true;
        }
        return false;
    }

    function handlePlayerKey(code) {
        if (code === KEY.RETURN) {
            stopPlayback();
            return true;
        }
        if (code === KEY.EXIT) {
            stopPlayback();
            exitApp();
            return true;
        }
        if (code === KEY.ENTER) {
            openLibraryOverlay();
            return true;
        }
        if (code === KEY.INFO) {
            toggleOverlay();
            return true;
        }
        if (code === KEY.UP || code === KEY.CHUP) {
            switchChannel(-1);
            return true;
        }
        if (code === KEY.DOWN || code === KEY.CHDOWN) {
            switchChannel(1);
            return true;
        }
        if (code === KEY.PLAY || code === KEY.PAUSE) {
            togglePlayback();
            return true;
        }
        if (code === KEY.GREEN) {
            toggleFavorite(state.currentChannel);
            return true;
        }
        if (code === KEY.YELLOW) {
            toggleFormat();
            return true;
        }
        return false;
    }

    function onKeyDown(event) {
        var code = event.keyCode || event.which;
        if (!IS_TV && code === 27) {
            code = KEY.RETURN;
        }

        var handled = false;
        if (code === KEY.VOL_UP) {
            handleVolume("VOL_UP");
            handled = true;
        } else if (code === KEY.VOL_DOWN) {
            handleVolume("VOL_DOWN");
            handled = true;
        } else if (code === KEY.MUTE) {
            handleVolume("MUTE");
            handled = true;
        } else if (state.screen === "loading") {
            handled = handleLoadingKey(code);
        } else if (state.screen === "browser") {
            handled = handleBrowserKey(code);
        } else if (state.screen === "library") {
            handled = handleBrowserKey(code);
            resetLibraryTimer();
        } else if (state.screen === "player") {
            handled = handlePlayerKey(code);
        }

        if (handled) {
            try {
                if (widgetAPI && typeof widgetAPI.blockNavigation === "function") {
                    widgetAPI.blockNavigation(event);
                }
            } catch (e) {
                /* ignore */
            }
            try {
                event.preventDefault();
            } catch (e) {
                /* ignore */
            }
            try {
                event.stopPropagation();
            } catch (e) {
                /* ignore */
            }
        }
    }

    /* ---------- Init ---------- */

    function init() {
        els.loading = $("loading");
        els.loadingBox = $("loading-box");
        els.loadingText = $("loading-text");
        els.loadingHint = $("loading-hint");
        els.browser = $("browser");
        els.player = $("player");
        els.groupList = $("group-list");
        els.channelList = $("channel-list");
        els.groupTitle = $("group-title");
        els.channelPos = $("channel-pos");
        els.statusLine = $("status-line");
        els.overlay = $("player-overlay");
        els.nowName = $("now-playing-name");
        els.nowGroup = $("now-playing-group");
        els.video = $("html5-video");
        els.tvPlayer = $("tv-player");
        els.nnavi = $("pluginObjectNNavi");
        els.tvmw = $("pluginObjectTVMW");
        els.audioPlugin = $("pluginObjectAudio");
        els.volumeBox = $("volume-box");
        els.volumeLabel = $("volume-label");
        els.volumeFill = $("volume-fill");
        els.toast = $("toast");

        player = new window.TvPlayer(els.video, els.tvPlayer);

        loadFavorites();
        loadView();
        initTvPlugins();

        if (document.addEventListener) {
            document.addEventListener("keydown", onKeyDown, false);
        } else {
            document.onkeydown = onKeyDown;
        }
        window.onresize = function () {
            if (state.screen === "browser" || state.screen === "library") {
                computeWindowSizes();
                renderAll();
            }
        };

        if (widgetAPI && typeof widgetAPI.sendReadyEvent === "function") {
            widgetAPI.sendReadyEvent();
        }

        fetchPlaylist();
    }

    window.onload = init;

    window.onunload = function () {
        if (player) {
            player.stop();
        }
    };
})();
