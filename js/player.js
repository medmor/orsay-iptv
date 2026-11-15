(function (root) {
    "use strict";

    function TvPlayer(videoEl, pluginEl) {
        this.video = videoEl;
        this.plugin = pluginEl;
        this.mode = null;
        this.paused = false;
        this.currentUrl = null;
        this.fallbackUrl = null;
        this.usedFallback = false;
    }

    TvPlayer.prototype.hasPlugin = function () {
        return !!(this.plugin && typeof this.plugin.Play === "function");
    };

    TvPlayer.prototype.activate = function (which) {
        if (this.video) {
            this.video.className = which === "html5" ? "video-layer is-active" : "video-layer";
        }
        if (this.plugin) {
            this.plugin.className = which === "plugin" ? "video-layer is-active" : "video-layer";
        }
    };

    TvPlayer.prototype.play = function (url, fallbackUrl) {
        this.stop();
        this.currentUrl = url;
        this.fallbackUrl = fallbackUrl || null;
        this.usedFallback = false;
        this.paused = false;

        if (this.hasPlugin()) {
            try {
                if (typeof this.plugin.InitPlayer === "function") {
                    this.plugin.InitPlayer();
                }
                if (typeof this.plugin.SetDisplayArea === "function") {
                    try {
                        this.plugin.SetDisplayArea(0, 0, 1280, 720);
                    } catch (e1) {
                        try {
                            this.plugin.SetDisplayArea(1280, 720);
                        } catch (e2) {
                            /* ignore */
                        }
                    }
                }
                this.activate("plugin");
                this.plugin.Play(url);
                this.mode = "plugin";
                return "plugin";
            } catch (e) {
                /* fall through to HTML5 */
            }
        }

        this.activate("html5");
        var self = this;
        this.video.onerror = function () {
            if (!self.usedFallback && self.fallbackUrl) {
                self.usedFallback = true;
                try {
                    self.video.src = self.fallbackUrl;
                    self.video.load();
                    self.video.play();
                } catch (e) {
                    /* ignore */
                }
            }
        };
        try {
            this.video.src = url;
            this.video.load();
            var promise = this.video.play();
            if (promise && typeof promise.catch === "function") {
                promise.catch(function () {});
            }
        } catch (e) {
            /* ignore */
        }
        this.mode = "html5";
        return "html5";
    };

    TvPlayer.prototype.stop = function () {
        if (this.plugin) {
            try {
                if (typeof this.plugin.Stop === "function") {
                    this.plugin.Stop();
                }
            } catch (e) {
                /* ignore */
            }
        }
        if (this.video) {
            try {
                this.video.pause();
            } catch (e) {
                /* ignore */
            }
            try {
                this.video.removeAttribute("src");
                this.video.load();
            } catch (e) {
                /* ignore */
            }
        }
        this.mode = null;
        this.paused = false;
        this.currentUrl = null;
        this.activate(null);
    };

    TvPlayer.prototype.togglePause = function () {
        if (this.mode === "html5") {
            try {
                if (this.video.paused) {
                    this.video.play();
                    this.paused = false;
                } else {
                    this.video.pause();
                    this.paused = true;
                }
            } catch (e) {
                /* ignore */
            }
            return this.paused;
        }

        if (this.mode === "plugin") {
            try {
                if (!this.paused) {
                    if (typeof this.plugin.Pause === "function") {
                        this.plugin.Pause();
                    } else if (typeof this.plugin.PausePlayer === "function") {
                        this.plugin.PausePlayer();
                    }
                    this.paused = true;
                } else {
                    if (typeof this.plugin.Resume === "function") {
                        this.plugin.Resume();
                    } else if (typeof this.plugin.ResumePlayer === "function") {
                        this.plugin.ResumePlayer();
                    } else if (typeof this.plugin.Play === "function") {
                        this.plugin.Play(this.currentUrl);
                    }
                    this.paused = false;
                }
            } catch (e) {
                /* ignore */
            }
            return this.paused;
        }

        return false;
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = TvPlayer;
    }
    if (root) {
        root.TvPlayer = TvPlayer;
    }
})(typeof window !== "undefined" ? window : this);
