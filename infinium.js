const express = require('express');
const bodyparser = require('body-parser');
const events = require('events');
const xml2js = require('xml2js');
const fs = require('fs');
const clone = require('./util/clone.js');
const copyRequest = require('./util/copy-request.js');
const WebFileCache = require('./util/web-file-cache.js');
const CarrierWeatherProvider = require('./util/carrier-weather-provider.js');
const WundergroundWeatherProvider = require('./util/wunderground-weather-provider.js');

const DEBUG_MODE = true;

const DEFAULT_LISTEN_PORT = 3000;
const DEFAULT_API_ENABLED = true;
const DEFAULT_FORWARD_INTERVAL = 15 * 60 * 1000; //in millis

const DATA_DIR = 'data/';
const CACHE_DIR = 'data/cache/';

const LOG_FILE = DATA_DIR + 'infinium.log';
const CONFIG_XML = DATA_DIR + 'config.xml';
const STATUS_XML = DATA_DIR + 'status.xml';
const SYSTEMS_XML = DATA_DIR + 'system.xml';


class Infinium {
    constructor(config = {}) {
        const infinium = this;

        const port = config.port || DEFAULT_LISTEN_PORT;
        const apiEnabled = config.enableApi || DEFAULT_API_ENABLED;
        const forwardInterval = config.forwardInterval || DEFAULT_FORWARD_INTERVAL;
        const debugMode = config.debugMode || DEBUG_MODE;

        const xmlBuilder = new xml2js.Builder();
        const parseXml2Json = xml2js.parseString;

        const cache = new WebFileCache({ cacheDir: CACHE_DIR, forwardInterval: forwardInterval });
        const server = express();


        infinium.eventEmitter = new events.EventEmitter();
        infinium.starting = true;
        infinium.running = false;
        infinium.changes = false;


        const debug = function (msg, trace = false, logToFile = false) {
            if (debugMode || trace) {
                console.log(msg);
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
            console.error(msg);

            if (logToFile) {
                try {
                    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} : error : ${msg}\n`, 'utf8');
                } catch (e) {
                    console.error(e);
                }
            }
        }

        const warn = function (msg, logToFile = true) {
            console.warn(msg);

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
            try {
                var process = function (err, newConfig) {
                    if (fromCarrier && !changes && newConfig.status.serverHasChanges === 'true') {
                        infinium.changes = true;
                        newConfig.status.pingRate = [12];
                        infinium.sendStatusToCarrier = new Date().getTime() + (2 * 60 * 1000);
                    }

                    infinium.xmlConfig = xmlBuilder.buildObject(newConfig);
                    infinium.config = newConfig;

                    infinium.eventEmitter.emit('config', infinium.config);
                    infinium.eventEmitter.emit('event', 'config', infinium.config);

                    try {
                        fs.writeFileSync(CONFIG_XML, infinium.xmlConfig);
                    } catch (e) {
                        error('Unable to save config.xml\n' + e);
                    }
                }

                if (typeof newConfig === 'string') {
                    parseXml2Json(newConfig, process);
                } else {
                    process(null, newConfig);
                }
            } catch (e) {
                error(e);
            }
        }

        infinium.updateStatus = function (newStatus) {
            var process = function (err, newStatus) {
                infinium.status = newStatus;
                infinium.xmlStatus = xmlBuilder.buildObject(newStatus);

                infinium.eventEmitter.emit('status', infinium.status);
                infinium.eventEmitter.emit('event', 'status', infinium.status);

                try {
                    fs.writeFileSync(STATUS_XML, infinium.xmlStatus);
                } catch (e) {
                    error('Unable to save status.xml\n' + e);
                }
            }

            if (typeof newStatus === 'string') {
                parseXml2Json(newStatus, process);
            } else {
                process(null, newStatus);
            }
        }

        infinium.updateSystems = function (newSystems, updateConfig = true) {
            var process = function (err, newSystems) {
                infinium.systems = newSystems;
                infinium.xmlSystems = xmlBuilder.buildObject(newSystems);

                if (updateConfig) {
                    infinium.updateConfig(xmlBuilder.buildObject({
                        config: infinium.systems.system.config[0]
                    }));
                }

                infinium.eventEmitter.emit('systems', infinium.systems);
                infinium.eventEmitter.emit('event', 'systems', infinium.systems);

                try {
                    fs.writeFileSync(SYSTEMS_XML, infinium.xmlSystems);
                } catch (e) {
                    error('Unable to save systems.xml\n' + e);
                }
            };

            if (typeof newSystems === 'string') {
                parseXml2Json(newSystems, process);
            } else {
                process(null, newSystems);
            }
        }


        //Express Start/Stop
        infinium.startServer = function (onStart = false) {
            if (onStart || (!running && !starting)) {
                server.listen(port, () => {
                    infinium.starting = false;
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

        fs.readFile(STATUS_XML, 'utf8', (err, data) => {
            if (!err) {
                debug('Status Loaded');
                infinium.updateStatus(data);
            }
        });

        fs.readFile(SYSTEMS_XML, 'utf8', (err, data) => {
            if (!err) {
                debug('Systems Loaded');
                infinium.updateSystems(data, false);
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
            } else if (infinium.xmlSystems) {
                debug('Sending config from systems.xml');
                var newXmlConfig = xmlBuilder.buildObject({
                    config: infinium.systems.system.config[0]
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
            if (xmlSystems) {
                debug('Sending systems.xml');
                res.send(xmlSystems);
            } else {
                debug('systems.xml not found');
                res.send('');
            }
        });

        //Thermostat reporting system
        server.post('/systems/:id', (req, res) => {
            debug('Receiving systems.xml');

            if (req.body.data !== 'error') {
                infinium.updateSystems(req.body.data);
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
                        error(`Unable to save ${key}.xml\n` + e);
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
                infinium.eventEmitter.emit('event', key, data);

                try {
                    fs.writeFileSync(DATA_DIR + key + '.xml', req.body.data);
                } catch (e) {
                    error(`Unable to save ${key}.xml\n` + e);
                }
            }

            cache.get(copyRequest(req), (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                } else {
                    res.send('');
                    error(err);
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
            infinium.weatherProvider.init(copyRequest(req));

            infinium.weatherProvider.getWeather((err, weather) => {
                if (!err) {
                    if (typeof weather === 'string') {
                        res.send(weather);
                        debug(`Sending Weather Data from ${infinium.weatherProvider.getName()}`);
                    } else {
                        var weatherConfig = {
                            weather_forecast: {
                                timestamp: new DateTime().toISOString(),
                                ping: 240,
                                days: weather
                            }
                        }

                        try {
                            var xml = xmlBuilder.buildObject(weatherConfig);
                            res.send(xml);
                            debug(`Sending Weather Data from ${infinium.weatherProvider.getName()}`);
                        } catch (e) {
                            res.send('');
                            error(e);
                        }
                    }
                } else {
                    res.send('');
                    error(err);
                }
            });
        });

        server.get('/:key', (req, res) => {
            var msg = 'Unknown Request: ' + req.params['key'];
            debug(msg);
            res.send(msg);
        });

        if (apiEnabled) {
            //add api functions
            server.get('/api/status', (req, res) => {
                res.send(infinium.status ? infinium.status.status : '');
            });
        }

        server.all('/*', (req, res) => {
            debug(`Unknown Request: ${req.host}${req.originalUrl}`);
        })

        if (config.wunderground) {
            var wu = config.wunderground;
            if (!wu.apiKey) {
                warn('No Wunderground API Key', true);
            } else if (!wu.zipCode && !wu.stationID && !(wu.geoCode && wu.geoCode.lat && wu.geoCode.lon)) {
                warn('No Wunderground Postal, Station or Geocode', true);
            } else {
                infinium.weatherProvider = new WundergroundWeatherProvider(wu);
            }
        }

        if (!infinium.weatherProvider) {
            infinium.weatherProvider = new CarrierWeatherProvider();
        }

        infinium.startServer(true);
    }

    getConfig() {
        return clone(this.config);
    }

    getStatus() {
        return clone(this.status);
    }

    onConfigUpdate(callback) {
        this.eventEmitter.on('config', callback);
    }

    onStatusUpdate(callback) {
        this.eventEmitter.on('status', callback);
    }

    onUpdate(callback) {
        this.eventEmitter.on('update', callback);
    }

    on(event, callback) {
        this.eventEmitter.on(event, callback);
    }


    start() {
        this.startServer();
    }

    stop() {
        this.stopServer();
    }
}

module.exports = Infinium;