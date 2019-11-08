const express = require('express');
const expressWS = require('express-ws');
const bodyparser = require('body-parser');
const events = require('events');
const xml2js = require('xml2js');
const fs = require('fs');
const utils = require('./util/utils.js')
const WebFileCache = require('./util/web-file-cache.js');
const CarrierWeatherProvider = require('./util/carrier-weather-provider.js');
const WundergroundWeatherProvider = require('./util/wunderground-weather-provider.js');

const DEBUG_MODE = false;

const DEFAULT_LISTEN_PORT = 3000;
const DEFAULT_WS_ENABLED = true;
const DEFAULT_API_ENABLED = true;
const DEFAULT_KEEP_OTHER_HISTORY = false;
const DEFAULT_FORWARD_INTERVAL = 15 * 60 * 1000; //in millis
const DEAFULT_WEATHER_REFRESH_RATE = 15 * 60 * 1000; //in millis

const DATA_DIR = process.env.INFINIUM_DATA || '/data/';
const DATA_HISTORY_DIR = process.env.INFINIUM_DATA_HISTORY || '/data/history/';
const CACHE_DIR = DATA_DIR + 'cache/';

const LOG_FILE = DATA_DIR + 'infinium.log';
const CONFIG_XML = DATA_DIR + 'config.xml';
const STATUS_XML = DATA_DIR + 'status.xml';
const SYSTEM_XML = DATA_DIR + 'system.xml';
const WEATHER_XML = DATA_DIR + 'weather.xml';
const MANIFEST_XML = DATA_DIR + 'manifest.xml';

const WS_STATUS = '/ws/status';
const WS_CONFIG = '/ws/config';
const WS_UPDATE = '/ws/update';

const Activities = {
    Home: 'home',
    Away: 'away',
    Sleep: 'sleep',
    Wake: 'wake',
    Manual: 'manual',
    All: ['home', 'away', 'sleep', 'wake', 'manual']
}

const FanModes = {
    Auto: 'off',
    Low: 'low',
    Med: 'med',
    High: 'high',
    All: ['off', 'low', 'med', 'high']
}


class Infinium {
    constructor(config = {}) {
        const infinium = this;

        const port = utils.getConfigVar(config.port, process.env.INFINIUM_PORT, DEFAULT_LISTEN_PORT);
        const wsEnabled = utils.getConfigVar(config.enableWs, process.env.INFINIUM_WS_ENABLED, DEFAULT_WS_ENABLED);
        const apiEnabled = utils.getConfigVar(config.enableApi, process.env.INFINIUM_API_ENABLED, DEFAULT_API_ENABLED);
        const keepOtherHistory = utils.getConfigVar(config.keepOtherHistory, process.env.INFINIUM_KEEP_OTHER_HISTORY, DEFAULT_KEEP_OTHER_HISTORY);
        const forwardInterval = utils.getConfigVar(config.forwardInterval, process.env.INFINIUM_FORWARD_INTERVAL, DEFAULT_FORWARD_INTERVAL);
        const weatherRefreshRate = utils.getConfigVar(config.weatherRefreshRate, process.env.INFINIUM_WEATHER_REFRESH_RATE, DEAFULT_WEATHER_REFRESH_RATE);
        const debugMode = utils.getConfigVar(config.debugMode, process.env.INFINIUM_DEBUG_MODE, DEBUG_MODE);

        const xmlBuilder = new xml2js.Builder({ headless: true });
        const xmlParser = new xml2js.Parser({ explicitArray: false });
        const parseXml2Json = function (xml, callback) {
            xmlParser.parseString(xml, callback);
        };

        const cache = new WebFileCache({ cacheDir: CACHE_DIR, forwardInterval: forwardInterval });
        const server = express();

        infinium.eventEmitter = new events.EventEmitter();
        infinium.running = false;
        infinium.changes = false;
        infinium.loading = true;


        const debug = function (msg, trace = false, logToFile = false) {
            if (debugMode || trace) {
                console.log(msg);
            }

            if (logToFile) {
                try {
                    fs.appendFileSync(LOG_FILE, `${new Date().toISOStringLocal()} : debug : ${msg}\n`, 'utf8');
                } catch (e) {
                    error(e);
                }
            }
        }

        const error = function (msg, logToFile = true) {
            console.error(msg);

            if (logToFile) {
                try {
                    fs.appendFileSync(LOG_FILE, `${new Date().toISOStringLocal()} : error : ${msg}\n`, 'utf8');
                } catch (e) {
                    console.error(e);
                }
            }
        }

        const warn = function (msg, logToFile = true) {
            console.warn(msg);

            if (logToFile) {
                try {
                    fs.appendFileSync(LOG_FILE, `${new Date().toISOStringLocal()} : warn : ${msg}\n`, 'utf8');
                } catch (e) {
                    console.error(e);
                }
            }
        }

        //Updaters
        infinium.updateStatus = function (newStatus, loading = false) {
            var process = function (xmlNewStatus, jsonNewStatus) {
                var processJson = function (err, jsonNewStatus) {
                    if (!err) {
                        infinium.status = jsonNewStatus;

                        const status = utils.adjustIds(infinium.status, true);
                        infinium.eventEmitter.emit('status', status.status);
                        infinium.eventEmitter.emit('update', 'status', status);

                        if (infinium.ws) {
                            infinium.ws.broadcast(WS_STATUS, status.status);
                        }
                    }
                };

                if (jsonNewStatus) {
                    processJson(null, jsonNewStatus);
                } else {
                    parseXml2Json(xmlNewStatus, processJson);
                }

                infinium.xmlStatus = xmlNewStatus;

                if (!loading) {
                    try {
                        fs.writeFileSync(STATUS_XML, infinium.xmlStatus);
                    } catch (e) {
                        error('Unable to save status.xml' + e);
                    }
                }
            };

            if (typeof newStatus === 'string') {
                process(newStatus)
            } else {
                process(xmlBuilder.buildObject(newStatus), newStatus);
            }
        }

        infinium.updateSystem = function (newSystem, loading = false) {
            var process = function (xmlNewSystem, jsonNewSystem) {
                var processJson = function (err, jsonNewSystem) {
                    if (!err) {
                        infinium.system = jsonNewSystem;

                        infinium.updateConfig(utils.clone(infinium.system.system));
                    } else {
                        error(err);
                    }
                };

                if (jsonNewSystem) {
                    processJson(null, jsonNewSystem);
                } else {
                    parseXml2Json(xmlNewSystem, processJson);
                }

                infinium.xmlSystem = xmlNewSystem;

                if (!loading) {
                    try {
                        fs.writeFileSync(SYSTEM_XML, infinium.xmlSystem);
                    } catch (e) {
                        error('Unable to save system.xml\n' + e);
                    }
                }
            };

            if (typeof newSystem === 'string') {
                process(newSystem);
            } else {
                process(xmlBuilder.buildObject(newSystem), newSystem);
            }
        }

        infinium.updateConfig = function (newConfig, fromCarrier = false, loading = false) {
            var process = function (xmlNewConfig, jsonNewConfig) {
                var processJson = function (err, jsonNewConfig) {
                    if (!err) {
                        infinium.config = jsonNewConfig;

                        const config = utils.adjustIds(infinium.config, true);
                        infinium.eventEmitter.emit('config', config.config);
                        infinium.eventEmitter.emit('update', 'config', config);

                        if (infinium.ws) {
                            infinium.ws.broadcast(WS_CONFIG, config.config);
                        }
                    } else {
                        error(err);
                    }
                };

                if (jsonNewConfig) {
                    processJson(null, jsonNewConfig);
                } else {
                    parseXml2Json(xmlNewConfig, processJson);
                }

                infinium.xmlConfig = xmlNewConfig;

                if (!loading) {
                    try {
                        fs.writeFileSync(CONFIG_XML, infinium.xmlConfig);
                    } catch (e) {
                        error('Unable to save config.xml' + e);
                    }
                }
            };

            if (typeof newConfig === 'string') {
                if (fromCarrier && !changes) {
                    parseXml2Json(newConfig, (err, jsonNewConfig) => {
                        if (!err) {
                            if (jsonNewConfig.status.serverHasChanges === 'true') {
                                infinium.changes = true;
                                jsonNewConfig.status.pingRate = 12;
                                infinium.sendStatusToCarrier = new Date().getTime() + (2 * 60 * 1000);

                                xmlNewConfig = xmlBuilder.buildObject(jsonNewConfig);

                                process(xmlNewConfig, jsonNewConfig);
                            } else {
                                process(newConfig);
                            }
                        } else {
                            error(err);
                        }
                    });
                } else {
                    process(newConfig);
                }
            } else {
                if (newConfig.$) {
                    newConfig.config.$ = newConfig.$;
                    delete newConfig.$;
                }
                process(xmlBuilder.buildObject(newConfig), newConfig);
            }
        }

        infinium.applySystemChanges = function (system) {
            infinium.updateSystem(system);
            infinium.changes = true;
            debug('Applied Changes to System');
        }

        //Express Start/Stop
        infinium.startServer = function () {
            if (!infinium.running) {
                server.listen(port, () => {
                    infinium.running = true;

                    debug(`Listening on port ${port}`, true, true);

                    if (apiEnabled) {
                        debug(`Remote API is Enabled`, true, true);
                    }

                    if (keepOtherHistory) {
                        debug(`Keep Other History Enabled '${DATA_HISTORY_DIR}'`, true, true);
                    }

                    if (debugMode) {
                        debug('Debug Mode Enabled');
                    }
                });
            }
        }

        infinium.stopServer = function () {
            if (running) {
                server.close();
                trace(`Server Closed`, true);
            }
        }


        //Load configs if available
        fs.readFile(CONFIG_XML, 'utf8', (err, data) => {
            if (!err) {
                debug('Config Loaded');
                infinium.updateConfig(data, false, true);
            }
        });

        fs.readFile(SYSTEM_XML, 'utf8', (err, data) => {
            if (!err) {
                debug('System Loaded');
                infinium.updateSystem(data, true);
            }
        });

        fs.readFile(STATUS_XML, 'utf8', (err, data) => {
            if (!err) {
                debug('Status Loaded');
                infinium.updateStatus(data, true);
            }
        });


        //server 
        server.use(bodyparser.json());
        server.use(bodyparser.urlencoded({ extended: false }));


        server.get('/', (req, res) => {
            //main page
            res.send('Infinium Server');
        });


        /* Thermostat Requests */
        server.get('/Alive', (req, res) => {
            debug('Sending Alive');

            res.send('alive');
        });

        server.get('/time', (req, res) => {
            debug('Sending Time');

            var xml = xmlBuilder.buildObject({
                time: {
                    $: {
                        "version": "1.9"
                    },
                    utc: new Date().toISOStringLocal()
                }
            });

            res.send(xml);
        });


        server.get('/manifest', (req, res) => {
            debug('Retreiving Manifest');
            cache.get({ request: utils.copyRequest(req), fileName: MANIFEST_XML }, (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                    debug('Sending Manifest');
                } else {
                    res.send('');
                    error('manifest- ' + err);
                    debug(`Request: ${utils.stringifyCirc(req)}`, false, true);
                }
            });
        });

        server.get('/releaseNotes/:id', (req, res) => {
            debug('Sending releaseNotes');

            var fileName = 'releaseNotes.txt';

            if (req.path) {
                var parts = req.path.split('/');
                fileName = parts[parts.length - 1];
            }

            cache.get({ request: utils.copyRequest(req), fileName: DATA_DIR + fileName }, (err, data, fromWeb) => {
                if (err) {
                    error(err);
                }
            });

            res.send('WARNING: Upgrading firmware may cause Infinium to stop working');
        });

        server.get('/updates/:key', (req, res) => {
            var fileName = 'system-update.hex';

            if (req.path) {
                var parts = req.path.split('/');
                fileName = parts[parts.length - 1];
            }

            cache.get({ request: req, fileName: DATA_DIR + fileName }, (err, data, fromWeb) => {
                if (err) {
                    error(err);
                }

                var notice = {
                    notice: 'System is trying to update itself. Check manifest for details',
                    url: utils.buildUrlFromRequest(req),
                    fileName: fileName
                }

                infinium.eventEmitter.emit('system_update', notice);
                infinium.eventEmitter.emit('update', 'system_update', notice);

                if (infinium.ws) {
                    infinium.ws.broadcast(WS_UPDATE, {
                        id: 'system_update',
                        data: notice
                    });
                }

                res.send('');
            });
        });


        //Thermostat checking for changes
        server.get('/systems/:id/config', (req, res) => {
            if (infinium.xmlConfig) {
                debug('Sending config.xml');
                res.send(xmlConfig);
            } else if (infinium.xmlSystem) {
                debug('Sending config from system.xml');
                var newXmlConfig = xmlBuilder.buildObject({
                    config: infinium.system.system.config
                });
                res.send(newXmlConfig);
            } else {
                cache.get({ request: utils.copyRequest(req), fileName: CONFIG_XML }, (err, data, fromWeb) => {
                    if (!err) {
                        infinium.updateConfig(data, true);
                        res.send(infinium.xmlConfig);
                    } else {
                        res.send('');
                        error(err);
                    }
                });
            }

            this.changes = false;
        });

        //Thermostat requesting system
        server.get('/systems/:id', (req, res) => {
            if (xmlSystem) {
                debug('Sending system.xml');
                res.send(xmlSystem);
            } else {
                debug('system.xml not found');
                res.send('');
            }
        });

        //Thermostat reporting system
        server.post('/systems/:id', (req, res) => {
            debug('Receiving system.xml');

            if (req.body.data !== 'error') {
                infinium.updateSystem(req.body.data);
            }

            cache.get(utils.copyRequest(req), (err, data, fromWeb) => {
                //ignore
            });

            res.send('');
        });

        //Thermostat reporting status
        server.post('/systems/:system_id/status', (req, res) => {
            debug('Receiving status.xml');

            if (req.body.data !== 'error') {
                infinium.updateStatus(req.body.data);
            }

            var buildResponse = function () {
                return xmlBuilder.buildObject({
                    status: {
                        $: '1.37',
                        configHasChanges: infinium.changes ? 'true' : 'false',
                        serverHasChanges: infinium.changes ? 'true' : 'false',
                        pingRate: infinium.changes ? 20 : 12
                    }
                });
            }

            if (infinium.sendStatusToCarrier && new Date().getTime() > infinium.sendStatusToCarrier) {
                cache.get({ request: utils.copyRequest(req), refresh: true }, (err, data, fromWeb) => {
                    if (!err) {
                        parseXml2Json(data, (err, obj) => {
                            if (!err) {
                                var changes = obj.status.serverHasChanges === 'true';
                                obj.status.pingRate = changes ? 20 : 12;
                                data = xmlBuilder.buildObject(obj);
                                res.send(data);
                                debug('Received and Forwared Status Response from Carrier');
                            } else {
                                res.send(buildResponse());
                                error('Received Status Response from Carrier but it Failed to parse.');
                                debug('Sent Status Response - Changes: ' + infinium.changes);
                            }

                            infinium.changes = false;
                        })

                        infinium.sendStatusToCarrier = null;
                    } else {
                        error(err);
                    }
                });
            } else {
                res.send(buildResponse());
                infinium.changes = false;

                debug(`Sending Status Response - Changes: ${infinium.changes}`);
            }
        });


        //Thermostat requesting other data
        server.get('/systems/:system_id/:key', (req, res) => {
            var key = req.params.key;

            cache.get({ request: utils.copyRequest(req), forwardInterval: 0 }, (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                } else {
                    res.send('');
                    error(err);
                    debug(`Request: ${utils.stringifyCirc(req)}`, false, true);
                }
            });
        });

        //Thermostat reporting other data
        server.post('/systems/:system_id/:key', (req, res) => {
            var key = req.params.key;
            debug(`Receiving ${key}.xml`);

            if (req.body.data !== 'error') {
                var data = utils.adjustIds(parseXml2Json(req.body.data));

                infinium.eventEmitter.emit(key, data);
                infinium.eventEmitter.emit('update', key, data);

                if (infinium.ws) {
                    infinium.ws.broadcast(`/ws/${key}`, data);
                    infinium.ws.broadcast(WS_UPDATE, {
                        id: key,
                        data: data
                    });
                }

                try {
                    fs.writeFileSync(`${DATA_DIR}${key}.xml`, req.body.data);

                    if (keepOtherHistory) {
                        var dt = new Date().toISOStringLocal().replace(/:/g, '-').replace('T', '_').replace('Z', '');
                        fs.writeFileSync(`${DATA_HISTORY_DIR}${key}_${dt}.xml`, req.body.data);
                    }
                } catch (e) {
                    error(`Unable to save ${key}.xml ` + e);
                }
            }

            cache.get(utils.copyRequest(req), (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                } else {
                    res.send('');
                    error(`Other Data (${key}) - ${err}`);
                    debug(`Copied Request: ${utils.stringifyCirc(utils.copyRequest(req))}\n`, false, true);
                    debug(`Request: ${utils.stringifyCirc(req)}\n`, false, true);
                }
            });
        });


        server.get('/weather/:zip/forecast', (req, res) => {
            var now = new Date().getTime();

            if (!infinium.lastWeatherUpdate || ((now - infinium.lastWeatherUpdate) > weatherRefreshRate)) {
                infinium.weatherProvider.getWeather(utils.copyRequest(req), (err, xmlWeather) => {
                    if (!err) {
                        res.send(xmlWeather);
                        infinium.xmlWeather = xmlWeather;
                        infinium.lastWeatherUpdate = now;
                        debug(`Sending Weather Data from ${infinium.weatherProvider.getName()}`);

                        try {
                            fs.writeFileSync(WEATHER_XML, xmlWeather);
                        } catch (e) {
                            error(`Unable to save weather.xml` + e);
                        }
                    } else {
                        res.send('');
                        error(err);
                    }
                });
            } else if (infinium.xmlWeather) {
                res.send(infinium.xmlWeather);
                debug(`Sending Cached Weather Data from ${infinium.weatherProvider.getName()}`);
            }
        });

        server.get('/:key', (req, res) => {
            var msg = 'Unknown Request (GET): /' + req.params['key'];
            debug(msg, true, true);
            res.send(msg);
        });


        if (apiEnabled) {
            server.get('/api/status', (req, res) => {
                res.send(infinium.status ? utils.adjustIds(infinium.status.status) : '');
            });

            server.get('/api/activity/:zone/:activity', (req, res) => {
                var zone;
                if (!(zone = utils.validateZone(req.params.zone))) {
                    res.send('Invalid Zone');
                } else if (!Activities.All.includes(req.params.activity.toLowerCase())) {
                    res.send('Invalid Activity');
                } else {
                    var activity = utils.adjustIds(utils.getActivity(this.system, zone, req.params.activity));

                    if (activity) {
                        res.send(activity);
                    } else {
                        res.send('');
                    }
                }

            });

            server.get('/api/schedule/:zone', (req, res) => {
                var zone;
                if (!(zone = utils.validateZone(req.params.zone))) {
                    res.send('Invalid Zone');
                } else {
                    var schedule = utils.getDay(utils.getZone(infinium.system, zone)).program;

                    if (schedule) {
                        res.send(utils.adjustIds(schedule, true));
                    } else {
                        res.send('');
                    }
                }

            });

            server.get('/api/schedule/:zone/:day', (req, res) => {
                var zone;
                if (!(zone = utils.validateZone(req.params.zone))) {
                    res.send('Invalid Zone');
                } else if (!utils.validateDay(req.params.day)) {
                    res.send('Invalid Day');
                } else {
                    var schedule = utils.getDay(utils.getZone(infinium.system, zone).program, req.params.day);

                    if (schedule) {
                        res.send(utils.adjustIds(schedule, true));
                    } else {
                        res.send('');
                    }
                }

            });

            server.get('/api/zone/:zone', (req, res) => {
                var zone;
                if (!(zone = utils.validateZone(req.params.zone))) {
                    res.send('Invalid Zone');
                } else {
                    var zone = utils.adjustIds(utils.getZone(this.system, zone));

                    if (zone) {
                        res.send(utils.adjustIds(zone, true));
                    } else {
                        res.send('');
                    }
                }

            });


            server.post('/api/activity/:zone/:activity', (req, res) => {
                if (req.params.zone && req.params.activity &&
                    (req.body.clsp || req.body.htsp || req.body.fan)) {
                    this.setActivity(req.params.zone, req.params.activity,
                        req.body.clsp || null,
                        req.body.htsp || null,
                        req.body.fan || null,
                        (err, system) => {
                            if (err) {
                                res.send(err);
                                warn(err);
                            } else {
                                res.send('sucess');
                                debug(`Activity set (${req.params.zone},${req.params.activity}:${
                                    req.body.clsp ? req.body.clsp : '*'
                                    },${
                                    req.body.htsp ? req.body.htsp : '*'
                                    },${
                                    req.body.fan ? req.body.fan : '*'
                                    }) from: ${req.connection.remoteAddress}`, true, true);
                            }
                        });
                } else {
                    res.send('Invalid Parameters');
                }
            });

            server.post('/api/hold/:zone', (req, res) => {
                if (req.params.zone) {
                    const activity = req.body.activity || 'home';
                    const holdUntil = req.body.holdUntil || null;

                    this.setHold(req.params.zone, req.body.hold || true,
                        activity, holdUntil,
                        (err, system) => {
                            if (err) {
                                res.send(err);
                                warn(err);
                            } else {
                                res.send('sucess');
                                debug(`Hold set (${req.params.zone},${activity},${holdUntil ? holdUntil : '*'}) from: ${req.connection.remoteAddress}`, true, true);
                            }
                        });
                } else {
                    res.send('Invalid Parameters');
                }
            });

            server.post('/api/schedule/:zone', (req, res) => {
                if (req.params.zone && req.body.schedule) {
                    this.setSchedule(req.params.zone, JSON.parse(req.body.schedule),
                        (err, system) => {
                            if (err) {
                                res.send(err);
                                warn(err);
                            } else {
                                res.send('sucess');
                                debug(`Schedule for Zone ${req.params.zone} updated from: ${req.connection.remoteAddress}`, true, true);
                            }
                        });
                } else {
                    res.send('Invalid Parameters');
                }
            });
        }

        if (wsEnabled) {
            infinium.ws = {};
            infinium.ws.server = expressWS(server);

            infinium.ws.broadcast = function (path, data) {
                try {
                    var clients = infinium.ws.server.getWss().clients

                    if (clients && clients.size > 0) {
                        clients = Array.from(clients).filter(s => {
                            return s.route === path;
                        });

                        clients.forEach((client) => {
                            client.send(JSON.stringify(data));
                        });

                        if (clients.length > 0) {
                            debug(`WS Sending '${path}' to ${clients.length} client${clients.length > 1 ? 's' : ''}`);
                        }
                    }
                } catch (e) {
                    error(`WS Broadcast (${path}) ` + e);
                }
            }


            server.ws(WS_STATUS, (ws, req) => {
                ws.route = WS_STATUS;

                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_STATUS}`);
                });

                debug(`Client connected to ${WS_STATUS}`);
            });

            server.ws(WS_CONFIG, (ws, req) => {
                ws.route = WS_CONFIG;

                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_CONFIG}`);
                });

                debug(`Client connected to ${WS_CONFIG}`);
            });

            server.ws(WS_UPDATE, (ws, req) => {
                ws.route = WS_UPDATE;

                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_UPDATE}`);
                });

                debug(`Client connected to ${WS_UPDATE}`);
            });

            server.ws('/ws/:key', (ws, req) => {
                const key = req.params.key;

                ws.route = `/ws/${key}`;

                ws.on('close', () => {
                    debug(`Client disconnected from /ws/${key}`);
                });

                debug(`Client connected to /ws/${key}`);
            });
        } else {
            server.all('/ws/:key', (req, res) => {
                res.send('Websockets are not enabled.');
            });
        }

        if (keepOtherHistory && !fs.existsSync(DATA_HISTORY_DIR)) {
            try {
                fs.mkdirSync(DATA_HISTORY_DIR, { recursive: true });
            } catch (e) {
                error(`Unable to create ${DATA_HISTORY_DIR}: ${e}`);
            }
        }

        server.all('/*', (req, res) => {
            res.statusMessage = "Invalid Request";
            res.status(400).end();
            debug(`Unknown Request: ${utils.buildUrlFromRequest(req)}`);
        });


        if (config.wunderground) {
            var wu = config.wunderground;
            if (!wu.apiKey) {
                warn('No Wunderground API Key', true);
            } else if (!wu.postalCode && !wu.stationID && !(wu.geoCode && wu.geoCode.lat && wu.geoCode.lon)) {
                warn('No Wunderground Postal, Station or Geocode', true);
            } else {
                infinium.weatherProvider = new WundergroundWeatherProvider(wu);
            }
        }

        if (!infinium.weatherProvider) {
            infinium.weatherProvider = new CarrierWeatherProvider();
        }
    }


    getConfig() {
        return utils.clone(this.config.config, true);
    }

    getStatus() {
        return utils.clone(this.status.status, true);
    }

    onConfigUpdate(callback) {
        this.eventEmitter.on('config', callback);
    }

    removeOnConfigUpdate(callback) {
        this.eventEmitter.removeListener('config', callback);
    }

    onStatusUpdate(callback) {
        this.eventEmitter.on('status', callback);
    }

    removeOnStatusUpdate(callback) {
        this.eventEmitter.removeListener('status', callback);
    }

    onUpdate(callback) {
        this.eventEmitter.on('update', callback);
    }

    removeOnUpdate(callback) {
        this.eventEmitter.removeListener('update', callback);
    }

    on(event, callback) {
        this.eventEmitter.on(event, callback);
    }

    removeOn(event, callback) {
        this.eventEmitter.removeListener(event, callback);
    }


    start() {
        this.startServer();
    }

    stop() {
        this.stopServer();
    }


    setHold(zone, hold = true, activity = 'home', holdUntil = null, callback) {
        if (this.system) {
            var czone;
            if (czone = utils.validateZone(zone)) {
                if (typeof hold === 'boolean' || hold === 'on' || hold === 'off') {
                    if (Activities.All.includes(activity)) {
                        if (utils.validateTime(holdUntil)) {
                            var system = utils.clone(this.system);
                            var szone = utils.getZone(system, czone);

                            if (szone) {
                                szone.hold = ((typeof hold === 'boolean') ? (hold === true ? 'on' : 'off') : hold);
                                szone.holdActivity = activity;
                                szone.otmr = (holdUntil) ? holdUntil : '';

                                this.applySystemChanges(system);

                                if (callback)
                                    callback(null, utils.adjustIds(system));
                            } else if (callback) {
                                callback('Can not find zone in config');
                            }
                        } else if (callback) {
                            callback(`Invalid Hold Until Value: ${holdUntil}`);
                        }
                    } else if (callback) {
                        callback(`Invalid Activity Value: ${activity}`);
                    }
                } else if (callback) {
                    callback(`Invalid Hold Value: ${hold}`);
                }
            } else if (callback) {
                callback(`Invalid Zone: ${zone}`);
            }
        } else if (callback) {
            callback('System not ready.');
        }
    }

    setActivity(zone, activity, clsp = null, htsp = null, fan = null, callback) {
        if (this.system) {
            const system = utils.clone(this.system);
            var czone, cclsp, chtsp;

            if (czone = utils.validateZone(zone)) {
                if (Activities.All.includes(activity)) {
                    if (cclsp = utils.validateTemp(clsp, system.system.config.vacmint, system.system.config.vacmaxt)) {
                        if (chtsp = utils.validateTemp(htsp, system.system.config.vacmint, system.system.config.vacmaxt)) {
                            if (fan === null || FanModes.All.includes(fan)) {
                                activity = utils.getActivity(system, czone, activity);

                                if (activity) {
                                    if (cclsp !== null) {
                                        activity.clsp = cclsp.toFixed(1);
                                    }

                                    if (chtsp !== null) {
                                        activity.htsp = chtsp.toFixed(1);
                                    }

                                    if (fan !== null) {
                                        activity.fan = fan;
                                    }

                                    this.applySystemChanges(system);

                                    if (callback)
                                        callback(null, utils.adjustIds(system));
                                } else if (callback) {
                                    callback('Can not find activity in config');
                                }
                            } else if (callback) {
                                callback(`Invalid Fan Mode: ${fan}`);
                            }
                        } else if (callback) {
                            callback(`Invalid Heating Setpoint: ${htsp}`);
                        }
                    } else if (callback) {
                        callback(`Invalid Cooling Setpoint: ${clsp}`);
                    }
                } else if (callback) {
                    callback(`Invalid Avtivity Value: ${activity}`);
                }
            } else if (callback) {
                callback(`Invalid Zone: ${zone}`);
            }
        } else if (callback) {
            callback('System not ready.');
        }
    }

    setSchedule(zone, schedule, callback) {
        var newSchedule, error;

        const processPeriod = function (currPeriod, newPeriod) {
            if (newPeriod.activity !== undefined) {
                if (Activities.All.includes(newPeriod.activity)) {
                    currPeriod.activity = newPeriod.activity;
                } else {
                    error = `Invalid Activity: ${newPeriod.activity}`;
                    return false;
                }
            }

            if (newPeriod.time !== undefined) {
                if (utils.validateTime(newPeriod.time)) {
                    currPeriod.time = newPeriod.time;
                } else {
                    error = `Invalid Time: ${newPeriod.time}`;
                    return false;
                }
            }

            const enable = (newPeriod.enable !== undefined ? newPeriod.enable : (newPeriod.enabled !== undefined ? newPeriod.enabled : undefined));
            if (enable !== undefined) {
                if (typeof enable === 'boolean' || enable === 'on' || enable === 'off') {
                    currPeriod.enabled = ((typeof enable === 'boolean') ? (enable === true ? 'on' : 'off') : enable);

                    if (currPeriod.enabled === 'off') {
                        currPeriod.time = '00:00';
                    }
                } else {
                    error = `Invalid Enabled Value: ${enable}`;
                    return false;
                }
            }

            return true;
        }

        const processDay = function (program, newDay) {
            const currDay = utils.getDay(program, newDay.id);

            if (currDay && Array.isArray(currDay.period)) {
                if (Array.isArray(newDay.periods)) {
                    newDay.periods.forEach(np => {
                        var npid;
                        if ((npid = utils.validatePeriod(np.id))) {
                            if (!processPeriod(utils.getPeriod(currDay, npid.toString()), np)) {
                                return false;
                            }
                        } else {
                            error = `Invalid Period: ${np.id}`;
                        }
                    });

                    var currPeriod, prevPeriod = utils.getPeriod(currDay, '1')
                    for (var i = 2; i < 6; i++) {
                        currPeriod = utils.getPeriod(currDay, i.toString());

                        if (prevPeriod.enabled === 'on') {
                            var prevTime = parseInt(prevPeriod.time.replace(/:/, ''));

                            if (currPeriod.enabled === 'on') {
                                var currTime = parseInt(currPeriod.time.replace(/:/, ''));

                                if (prevTime >= currTime) {
                                    error = 'Each period must take place after the one before it.';
                                    return false;
                                }

                                prevPeriod = currPeriod;
                            }
                        }
                    }

                    return true;
                } else {
                    error = 'Could not find periods in newDay';
                }
            } else {
                error = 'Could not find Day in config';
            }

            return false;
        }

        if (Array.isArray(schedule)) {
            newSchedule = schedule;
        } else if (Array.isArray(schedule.schedule)) {
            newSchedule = schedule.schedule;
        } else if (callback) {
            callback('Invalid Schedule');
            return;
        }

        var czone;
        if (this.system) {
            if ((czone = utils.validateZone(zone))) {
                const system = utils.clone(this.system);
                const program = utils.getZone(system, czone).program

                newSchedule.forEach(newDay => {
                    if (utils.validateDay(newDay.id)) {
                        if (!processDay(program, newDay) && callback) {
                            callback(error)
                            return;
                        }
                    } else if (callback) {
                        callback(`Invalid Day: ${newDay.id}`)
                        return;
                    }
                });

                this.applySystemChanges(system);
                callback(null, utils.adjustIds(system));
            } else if (callback) {
                callback(`Invalid Zone: ${zone}`);
            }
        } else if (callback) {
            callback('System not ready.');
        }
    }
}

module.exports = Infinium;