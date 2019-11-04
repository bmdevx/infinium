const express = require('express');
const expressWS = require('express-ws');
const bodyparser = require('body-parser');
const events = require('events');
const xml2js = require('xml2js');
const fs = require('fs');
const clone = require('./util/clone.js');
const copyRequest = require('./util/copy-request.js');
const WebFileCache = require('./util/web-file-cache.js');
const CarrierWeatherProvider = require('./util/carrier-weather-provider.js');
const WundergroundWeatherProvider = require('./util/wunderground-weather-provider.js');

const DEBUG_MODE = false;

const DEFAULT_LISTEN_PORT = 3000;
const DEFAULT_WS_ENABLED = true;
const DEFAULT_API_ENABLED = true;
const DEFAULT_FORWARD_INTERVAL = 15 * 60 * 1000; //in millis
const DEAFULT_WEATHER_REFRESH_RATE = 15 * 60 * 1000; //in millis

const DATA_DIR = process.env.INFINIUM_DATA || '/data/';
const CACHE_DIR = DATA_DIR + 'cache/';

const LOG_FILE = DATA_DIR + 'infinium.log';
const CONFIG_XML = DATA_DIR + 'config.xml';
const STATUS_XML = DATA_DIR + 'status.xml';
const SYSTEM_XML = DATA_DIR + 'system.xml';
const WEATHER_XML = DATA_DIR + 'weather.xml';

const WS_STATUS = '/ws/status';
const WS_CONFIG = '/ws/config';
const WS_SYSTEM = '/ws/system';
const WS_UPDATE = '/ws/update';
const WS_OTHER = '/ws/:key';


class Infinium {
    constructor(config = {}) {
        const infinium = this;

        const port = config.port || process.env.INFINIUM_PORT || DEFAULT_LISTEN_PORT;
        const wsEnabled = config.enableWs || process.env.INFINIUM_WS_ENABLED || DEFAULT_WS_ENABLED;
        const apiEnabled = config.enableApi || process.env.INFINIUM_API_ENABLED || DEFAULT_API_ENABLED;
        const forwardInterval = config.forwardInterval || process.env.INFINIUM_FORWARD_INTERVAL || DEFAULT_FORWARD_INTERVAL;
        const weatherRefreshRate = config.weatherRefreshRate || process.env.INFINIUM_WEATHER_REFRESH_RATE || DEAFULT_WEATHER_REFRESH_RATE;
        const debugMode = config.debugMode || process.env.INFINIUM_DEBUG_MODE || DEBUG_MODE;

        const xmlBuilder = new xml2js.Builder();
        const xmlParser = new xml2js.Parser({ explicitArray: false });
        const parseXml2Json = function (xml, callback) {
            xmlParser.parseString(xml, callback);
        };

        const cache = new WebFileCache({ cacheDir: CACHE_DIR, forwardInterval: forwardInterval });
        const server = express();

        infinium.eventEmitter = new events.EventEmitter();
        infinium.running = false;
        infinium.changes = false;


        const debug = function (msg, trace = false, logToFile = false) {
            if (debugMode || trace) {
                console.log(msg + '\n');
            }

            if (logToFile) {
                try {
                    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} : debug : ${msg}\n`, 'utf8');
                } catch (e) {
                    error(e);
                }
            }
        }

        const error = function (msg, logToFile = true) {
            console.error(msg + '\n');

            if (logToFile) {
                try {
                    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} : error : ${msg}\n`, 'utf8');
                } catch (e) {
                    console.error(e);
                }
            }
        }

        const warn = function (msg, logToFile = true) {
            console.warn(msg + '\n');

            if (logToFile) {
                try {
                    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} : warn : ${msg}\n`, 'utf8');
                } catch (e) {
                    console.error(e);
                }
            }
        }

        //Updaters
        infinium.updateConfig = function (newConfig, fromCarrier = false) {
            var process = function (xmlNewConfig, jsonNewConfig) {
                var processJson = function (err, jsonNewConfig) {
                    if (!err) {
                        infinium.config = jsonNewConfig;

                        const config = clone(infinium.config);
                        infinium.eventEmitter.emit('config', config.config);
                        infinium.eventEmitter.emit('update', 'config', config);

                        if (infinium.wsBroadcast) {
                            infinium.wsBroadcast(WS_CONFIG, config.config);
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

                try {
                    fs.writeFileSync(CONFIG_XML, infinium.xmlConfig);
                } catch (e) {
                    error('Unable to save config.xml' + e);
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
                process(xmlBuilder.buildObject(newConfig), newConfig);
            }
        }

        infinium.updateStatus = function (newStatus) {
            var process = function (xmlNewStatus, jsonNewStatus) {
                var processJson = function (err, jsonNewStatus) {
                    if (!err) {
                        infinium.status = jsonNewStatus;

                        const status = clone(infinium.status);
                        infinium.eventEmitter.emit('status', status.status);
                        infinium.eventEmitter.emit('update', 'status', status);

                        if (infinium.wsBroadcast) {
                            infinium.wsBroadcast(WS_STATUS, status.status);
                        }
                    }
                };

                if (jsonNewStatus) {
                    processJson(null, jsonNewStatus);
                } else {
                    parseXml2Json(xmlNewStatus, processJson);
                }

                infinium.xmlStatus = xmlNewStatus;

                try {
                    fs.writeFileSync(STATUS_XML, infinium.xmlStatus);
                } catch (e) {
                    error('Unable to save status.xml' + e);
                }
            };

            if (typeof newStatus === 'string') {
                process(newStatus)
            } else {
                process(xmlBuilder.buildObject(newStatus), newStatus);
            }
        }

        infinium.updateSystem = function (newSystem, updateConfig = true) {
            var process = function (xmlNewSystem, jsonNewSystem) {
                var processJson = function (err, jsonNewSystem) {
                    if (!err) {
                        infinium.system = jsonNewSystem;

                        const system = clone(infinium.system);
                        infinium.eventEmitter.emit('system', system.system);
                        infinium.eventEmitter.emit('update', 'system', system);

                        if (infinium.wsBroadcast) {
                            infinium.wsBroadcast(WS_SYSTEM, system.system);
                        }

                        if (updateConfig) {
                            infinium.updateConfig(xmlBuilder.buildObject({
                                config: infinium.system.system.config
                            }));
                        }
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

                try {
                    fs.writeFileSync(SYSTEM_XML, infinium.xmlSystem);
                } catch (e) {
                    error('Unable to save system.xml\n' + e);
                }
            };

            if (typeof newSystem === 'string') {
                process(newSystem);
            } else {
                process(xmlBuilder.buildObject(newSystem), newSystem);
            }
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
                infinium.updateConfig(data);
            }
        });

        fs.readFile(SYSTEM_XML, 'utf8', (err, data) => {
            if (!err) {
                debug('System Loaded');
                infinium.updateSystem(data, false);
            }
        });

        fs.readFile(STATUS_XML, 'utf8', (err, data) => {
            if (!err) {
                debug('Status Loaded');
                infinium.updateStatus(data);
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
                    utc: new Date().toISOString()
                }
            });

            res.send(xml);
        });

        server.get('/releaseNotes/:id', (req, res) => {
            debug('Sending releaseNotes');

            cache.get({ request: copyRequest(req), fileName: DATA_DIR + 'relaseNotes.txt' }, (err, data, fromWeb) => {
                if (err) {
                    error(err);
                }
            });

            res.send('WARNING: Upgrading firmware may cause Infinium to stop working');
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
                cache.get({ request: copyRequest(req), fileName: CONFIG_XML }, (err, data, fromWeb) => {
                    if (!err) {
                        infinium.updateConfig(data, true);
                    } else {
                        res.send('');
                        error(err);
                    }
                });
            }
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

            cache.get(copyRequest(req), (err, data, fromWeb) => {
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
                cache.get({ request: copyRequest(req), refresh: true }, (err, data, fromWeb) => {
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
                                infinium.changes = false;
                            }
                        })

                        infinium.sendStatusToCarrier = null;
                    } else {
                        error(err);
                    }
                });
            } else {
                res.send(buildResponse());

                debug('Sent Status Response - Changes: ' + infinium.changes);
                infinium.changes = false;
            }
        });

        //Thermostat requesting other data
        server.get('/systems/:system_id/:key', (req, res) => {
            var key = req.params.key;

            cache.get({ request: copyRequest(req), forwardInterval: 0 }, (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);

                    try {
                        fs.writeFileSync(DATA_DIR + key + '.xml', req.body.data);
                    } catch (e) {
                        error(`Unable to save ${key}.xml` + e);
                    }
                } else {
                    res.send('');
                    error(err);
                }
            });
        });

        //Thermostat reporting other data
        server.post('/systems/:system_id/:key', (req, res) => {
            var key = req.params.key;
            debug(`Receiving ${key}.xml`);

            if (req.body.data !== 'error') {
                var data = parseXml2Json(req.body.data);

                infinium.eventEmitter.emit(key, data);
                infinium.eventEmitter.emit('update', key, data);

                if (infinium.wsBroadcast) {
                    infinium.wsBroadcast(`/ws/${key}`, data);
                    infinium.wsBroadcast(WS_OTHER, {
                        id: key,
                        data: data
                    });
                }

                try {
                    fs.writeFileSync(DATA_DIR + key + '.xml', req.body.data);
                } catch (e) {
                    error(`Unable to save ${key}.xml` + e);
                }
            }

            cache.get(copyRequest(req), (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                } else {
                    res.send('');
                    error(`Other Data (${key}) - ${err}`);
                }
            });
        });

        server.get('/systems/manifest', (req, res) => {
            debug('Sending Manifest');
            cache.get(copyRequest(req), (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                } else {
                    res.send('');
                    error('manifest- ' + err);
                }
            });
        });

        server.get('/weather/:zip/forecast', (req, res) => {
            var now = new Date().getTime();

            if (!infinium.lastWeatherUpdate || ((now - infinium.lastWeatherUpdate) > weatherRefreshRate)) {
                infinium.weatherProvider.init(copyRequest(req));

                infinium.weatherProvider.getWeather((err, xmlWeather) => {
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
            var msg = 'Unknown Request: ' + req.params['key'];
            debug(msg);
            res.send(msg);
        });

        if (apiEnabled) {
            server.get('/api/status', (req, res) => {
                res.send(infinium.status ? infinium.status.status : '');
            });

            //add api functions
        }

        if (wsEnabled) {
            infinium.wsServer = expressWS(server);

            infinium.wsBroadcast = function (path, data) {
                try {
                    const clients = infinium.wsServer.getWss(path).clients;

                    if (clients && clients.size > 0) {
                        clients.forEach((client) => {
                            client.send(JSON.stringify(data));
                        });
                        debug(`WS Sending '${path}' to ${clients.size} client${clients.size > 1 ? 's' : ''}`);
                    }
                } catch (e) {
                    error(`WS Broadcast (${path}) ` + e);
                }
            }


            server.ws(WS_STATUS, (ws, req) => {
                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_STATUS}`);
                });

                debug(`Client connected to ${WS_STATUS}`);
            });

            server.ws(WS_SYSTEM, (ws, req) => {
                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_SYSTEM}`);
                });

                debug(`Client connected to ${WS_SYSTEM}`);
            });

            server.ws(WS_CONFIG, (ws, req) => {
                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_CONFIG}`);
                });

                debug(`Client connected to ${WS_CONFIG}`);
            });

            server.ws(WS_UPDATE, (ws, req) => {
                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_UPDATE}`);
                });

                debug(`Client connected to ${WS_UPDATE}`);
            });

            server.ws(WS_OTHER, (ws, req) => {
                const key = req.params['key'];
                ws.on('close', () => {
                    debug(`Client disconnected from ${key}`);
                });

                debug(`Client connected to ${key}`);
            });
        }

        server.all('/*', (req, res) => {
            debug(`Unknown Request: ${req.host}${req.originalUrl}`);
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
        return clone(this.config.config);
    }

    getStatus() {
        return clone(this.status.status);
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
}

module.exports = Infinium;