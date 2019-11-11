const request = require('request');
const fs = require('fs');
const fsp = fs.promises;

const DEFAULT_FORDWARD_INTERVAL = 15 * 60 * 1000; //15 minutes in millis
const CACHE_FILE_NAME = 'cache.json';
const DEFAULT_CACHE_DIR = 'cache/';

const checkExists = (path) => new Promise(r => fs.access(path, fs.F_OK, e => r(!e)));

class WebFileCache {

    constructor(config = {}) {
        const wfc = this;

        wfc.cacheDir = config.cacheDir || DEFAULT_CACHE_DIR;
        wfc.forwardInterval = config.forwardInterval || DEFAULT_FORDWARD_INTERVAL;
        wfc.cache = new Map();

        if (!wfc.cacheDir.endsWith('/')) {
            wfc.cacheDir += '/';
        }

        wfc.cacheFilePath = wfc.cacheDir + CACHE_FILE_NAME;

        wfc.requestToKey = (config) => {
            var url = (typeof config.req === "object") ? config.req.url : ((typeof config.req === "string") ? config.req : '');

            if (config.url == '')
                throw 'Error: Invalid URL';

            if (config.useGetKeys) {
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

        wfc.createFileCacheConfig = (key, config = {}) => {
            return {
                forwardInterval: (config.forwardInterval || this.forwardInterval),
                lastRetrieved: config.lastRetrieved || 0,
                file: config.fileName || (config.cacheDir || this.cacheDir) +
                    (key.replace(/[/\\|&;$%@"<>()+,]/g, "").replace(':', '-') + '.cache')
            }
        }

        wfc.saveCache = function () {
            fsp.writeFile(wfc.cacheFilePath, JSON.stringify(Array.from(wfc.cache.entries())), 'utf8')
                .catch(e => console.error(`Unable to save ${CACHE_FILE_NAME} - ${e}`));
        }

        const checkAndCreateCacheFile = new Promise((resolve, reject) => {
            checkExists(wfc.cacheFilePath)
                .then(exists => {
                    if (exists) {
                        var content = fs.readFileSync(wfc.cacheFilePath, 'utf8');
                        if (content) {
                            try {
                                wfc.cache = new Map(JSON.parse(content));
                                resolve();
                            } catch (e) {
                                reject(e);
                            }
                        } else {
                            resolve();
                        }
                    } else {
                        wfc.saveCache();
                    }
                })
                .catch(e => console.error(e));
        });

        checkExists(this.cacheDir)
            .then(exists => {
                if (exists) {
                    checkAndCreateCacheFile.then();
                } else {
                    fsp.mkdir(this.cacheDir, { recursive: true })
                        .then(_ => checkAndCreateCacheFile.then())
                        .catch(_ => console.error(`Unable to creaate ${this.cacheDir} directory`));
                }
            })
            .catch(e => console.error(e));;
    }

    get(obj) { //gets config for specific request
        return new Promise((resolve, reject) => {

            var req, config = { refresh: false };
            if (typeof obj === 'string') {
                req = obj;
                config.req = req;
            } else if (typeof obj === 'object') {
                if (obj.request) {
                    req = obj.request;
                    config.req = req;
                }

                if (obj.url || (obj.hostname && obj.path)) {
                    req = obj;
                    config.req = req;
                }

                if (obj.refresh) {
                    config.refresh = obj.refresh;
                }

                if (obj.passRequest) {
                    config.passRequest = obj.request;
                }

                if (obj.useGetKeys) {
                    config.useGetKeys = obj.useGetKeys;
                }

                if (obj.fileName) {
                    config.fileName = obj.fileName;
                }
            }

            if (!req) {
                throw 'Error: No Request';
            } else if (typeof req !== 'string') {
                if (!req.url.includes(':')) {
                    req.url = `${req.protocol || 'http'}://${req.hostname || req.host}${req.baseUrl || req.path}`;
                }

                if (!req.timeout) {
                    req.timeout = 1500;
                }
            }

            var key = this.requestToKey(config);
            var fcc;

            if (this.cache.has(key)) {
                fcc = this.cache.get(key);

                if (config.fileName && !fcc.file.endsWith(config.fileName)) {
                    fcc.file = config.fileName;
                }
            } else {
                fcc = this.createFileCacheConfig(key, config);
                this.cache.set(key, fcc);
            }

            var time = (new Date().getTime() - fcc.lastRetrieved);

            if (config.refresh || (time > fcc.forwardInterval) || !fs.existsSync(fcc.file)) {
                const method = req.method;
                request(req, (err, res, data) => {
                    if (!err) {
                        if (res.statusCode === 200) {
                            fsp.writeFile(fcc.file, data, 'utf8')
                                .then(_ => {
                                    fcc.lastRetrieved = new Date().getTime();
                                    resolve({ data: data, fromWeb: true })
                                })
                                .catch(e => {
                                    reject(`Unable to save cache file: ${fcc.file} - ${e}`);
                                });
                        } else {
                            reject(`Request Status Error ${method ? `[${method}]` : ''}(${req.url}): ${res.statusCode}`);
                            fcc.lastRetrieved = new Date().getTime(); // say it went ok even if it fails as their servers have issues
                        }
                    } else {
                        reject(`Request Error ${method ? `[${method}]` : ''}(${req.url}): ${err}`);
                        fcc.lastRetrieved = new Date().getTime(); // say it went ok even if it fails as their servers have issues
                    }

                    this.saveCache();
                });
            } else {
                fsp.readFile(fcc.file, 'utf8')
                    .then(data => {
                        resolve({ data: data, fromWeb: false })
                    });
            }
        });
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
