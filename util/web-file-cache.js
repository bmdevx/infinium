const request = require('request');
const fs = require('fs');

const DEFAULT_FORDWARD_INTERVAL = 15 * 60 * 1000; //15 minutes in millis
const CACHE_FILE_NAME = 'cache.json';
const DEFAULT_CACHE_DIR = 'cache/';

class WebFileCache {

    constructor(config = {}) {
        this.cacheDir = config.cacheDir || DEFAULT_CACHE_DIR;
        this.forwardInterval = config.forwardInterval || DEFAULT_FORDWARD_INTERVAL;
        this.cache = new Map();

        if (!this.cacheDir.endsWith('/')) {
            this.cacheDir += '/';
        }

        this.cacheFilePath = this.cacheDir + CACHE_FILE_NAME;

        this.requestToKey = function (req, useGetKeys = false) {
            var url = (typeof req === "object") ? req.url : ((typeof req === "string") ? req : '');

            if (url == '')
                throw 'Error: Invalid URL';

            if (useGetKeys) {
                var qIndex = url.indexOf('?');

                if (qIndex < 0) {
                    return url.substring(0, url.length - 1);
                } else {
                    return url;
                    // var baseUrl = req.url.substring(0, qIndex);
                    // var kps = url.substring(qIndex - 1, url.length);
                    // var pairs = kps.split('&');

                    // var endKey = '';

                    // pairs.forEach((kvp) => { endKey += kvp.substring(0, kvp.indexOf('=')) + ',' });

                    // return baseUrl + '?' + endKey;
                }
            } else {
                return url;
            }
        }

        this.createFileCacheConfig = function (key, config = {}) {
            return {
                forwardInterval: (config.forwardInterval || this.forwardInterval),
                lastRetrieved: config.lastRetrieved || 0,
                file: (config.cacheDir || this.cacheDir) +
                    (config.fileName || key.replace(/[/\\|&;$%@"<>()+,]/g, "").replace(':', '-') + '.cache')
            }
        }

        this.saveCache = function () {
            fs.writeFileSync(this.cacheFilePath, JSON.stringify(Array.from(this.cache.entries())), 'utf8');
        }



        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        } else {
            if (fs.existsSync(this.cacheFilePath)) {
                var content = fs.readFileSync(this.cacheFilePath, 'utf8');
                if (content) {
                    this.cache = new Map(JSON.parse(content));
                }
            } else {
                this.saveCache();
            }
        }
    }

    get(obj, callback) { //sets config for specific request
        var req, fileName, refresh = false, config = {};
        if (typeof obj === 'string') {
            req = obj;
        } else if (typeof obj === 'object') {
            if (obj.request) {
                req = obj.request;
            }

            if (obj.url) {
                req = obj;
            }

            if (obj.refresh) {
                refresh = obj.refresh;
            }

            if (obj.passRequest) {
                passRequest = obj.passRequest;
            }

            if (obj.useGetKeys) {
                config = obj.config;
            }
        }

        if (!req) {
            throw 'Error: No Request';
        } else if (typeof req !== 'string' && !req.url.includes(':')) {
            req.url = `${req.protocol || 'http'}://${req.host || req.hostname}${req.baseUrl || req.path}`;
        }

        var key = this.requestToKey(req, config.useGetKeys || false);
        var fcc;

        if (this.cache.has(key)) {
            fcc = this.cache.get(key);

            if (config.fileName && !fcc.file.endsWith(config.fileName)) {
                fcc.file = this.cacheDir + config.fileName;
            }
        } else {
            fcc = this.createFileCacheConfig(key, config);
            this.cache.set(key, fcc);
        }

        var time = (new Date().getTime() - fcc.lastRetrieved);

        if (refresh || (time > fcc.forwardInterval) || !fs.exists(fcc.file)) {
            request(req, (err, res, data) => {
                if (!err) {
                    if (res.statusCode === 200) {
                        try {
                            fs.writeFile(fcc.file, data, 'utf8');
                            fcc.lastRetrieved = new Date().getTime();
                            this.saveCache();
                            callback(null, data, true);
                        } catch (ferr) {
                            callback(ferr);
                        }
                    } else {
                        callback(`Request Status Error: ${res.statusCode}`);
                    }
                } else {
                    callback(`Request (${req.url}) Error: ${err}`);
                }
            });
        } else {
            fs.readFile(fcc.file, 'utf8', (err, data) => {
                callback(err, data, false);
            });
        }
    }

    cachedFileExists(request, useGetKeys = false) {
        return this.cache.has(this.requestToKey(request, useGetKeys));
    }

    clear(deleteFiles = false) {
        if (deleteFiles) {
            this.cache.entries().forEach(entry => {
                fs.unlinkSync(entry.value.file);
            });
        }

        this.cache.clear();
        this.saveCache();
    }
}

module.exports = WebFileCache;
