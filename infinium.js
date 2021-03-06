const express = require('express');
const expressWS = require('express-ws');
const bodyparser = require('body-parser');
const events = require('events');
const xml2js = require('xml2js');
const fs = require('fs');
const fsp = require('fs').promises;
const utils = require('./utils/utils.js')
const WebFileCache = require('./utils/web-file-cache.js');
const CarrierWeatherProvider = require('./utils/carrier-weather-provider.js');
const WundergroundWeatherProvider = require('./utils/wunderground-weather-provider.js');
const path = require('path');

const DEBUG_MODE = false;

const ONE_MIN = 1 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const CARRIER_REQUEST_TIMEOUT = 3 * 60 * 1000; // It is long since their servers are super slows

const DEFAULT_TZ = 0;
const DEFAULT_PORT = 3000;
const DEFAULT_WS_ENABLED = true;
const DEFAULT_API_ENABLED = true;
const DEFAULT_KEEP_HISTORY = false;
const DEFAULT_KEEP_HISTORY_ON_CHANGE = true;
const DEFAULT_FORWARD_INTERVAL = FIFTEEN_MIN; //in millis
const DEAFULT_WEATHER_REFRESH_RATE = FIFTEEN_MIN; //in millis
const DEFAULT_HISTORY_EXCLUSIONS = 'config,dealer,idu_config,odu_config,profile,status,system,weather'

const DATA_DIR = process.env.INFINIUM_DATA || '/data/';
const DATA_HISTORY_DIR = process.env.INFINIUM_DATA_HISTORY || '/data/history/';
const CACHE_DIR = DATA_DIR + 'cache/';

const LOG_FILE = DATA_DIR + 'infinium.log';
const CONFIG_XML = 'config.xml';
const STATUS_XML = 'status.xml';
const SYSTEM_XML = 'system.xml';

const WS_CONFIG = '/ws/config';
const WS_STATUS = '/ws/status';
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

        const PORT = utils.getConfigVar(config.port, process.env.INFINIUM_PORT, DEFAULT_PORT);
        const WS_ENABLED = utils.getConfigVar(config.enableWs, process.env.INFINIUM_WS_ENABLED, DEFAULT_WS_ENABLED);
        const API_ENABLED = utils.getConfigVar(config.enableApi, process.env.INFINIUM_API_ENABLED, DEFAULT_API_ENABLED);
        const KEEP_HISTORY = utils.getConfigVar(config.keepHistory, process.env.INFINIUM_KEEP_HISTORY, DEFAULT_KEEP_HISTORY);
        const HISTORY_EXCLUSIONS = utils.getConfigVar(config.historyExclusions, process.env.INFINIUM_HISTORY_EXCLUSIONS, DEFAULT_HISTORY_EXCLUSIONS);
        const KEEP_HISTORY_ON_CHANGE = utils.getConfigVar(config.keepHistoryOnChange, process.env.INFINIUM_KEEP_HISTORY_ON_CHANGE, DEFAULT_KEEP_HISTORY_ON_CHANGE);
        const HISTORY_EXCLUSIONS_ARR = HISTORY_EXCLUSIONS ? HISTORY_EXCLUSIONS.split(',').map(item => item.trim()) : [];
        const FORWARD_INTERVAL = utils.getConfigVar(config.forwardInterval, process.env.INFINIUM_FORWARD_INTERVAL, DEFAULT_FORWARD_INTERVAL);
        const WEATHER_REFRESH_RATE = utils.getConfigVar(config.weatherRefreshRate, process.env.INFINIUM_WEATHER_REFRESH_RATE, DEAFULT_WEATHER_REFRESH_RATE);
        const DEBUG = utils.getConfigVar(config.debugMode, process.env.INFINIUM_DEBUG_MODE, DEBUG_MODE);
        const TZ = utils.getConfigVar(config.tz, process.env.INFINIUM_TZ, DEFAULT_TZ);

        const xmlBuilder = new xml2js.Builder({ headless: true });
        const xmlParser = new xml2js.Parser({ explicitArray: false });
        const parseXml2Json = (xml) => {
            return xmlParser.parseStringPromise(xml);
        }
        const buildXml = (obj) => {
            return new Promise((resolve, reject) => {
                try {
                    resolve(xmlBuilder.buildObject(obj));
                } catch (e) {
                    reject(e);
                }
            });
        }


        const debug = function (msg, trace = false, logToFile = false) {
            if (DEBUG || trace) {
                console.log(msg);
            }

            if (logToFile) {
                fsp.appendFile(LOG_FILE, `${new Date().toISOStringLocal(TZ)} : debug : ${msg}\n`)
                    .catch(e => warn(e, false));
            }
        };
        const error = function (msg, logToFile = true) {
            console.error(msg);

            if (logToFile) {
                fsp.appendFile(LOG_FILE, `${new Date().toISOStringLocal(TZ)} : error : ${msg}\n`)
                    .catch(e => warn(e, false));
            }
        };
        const warn = function (msg, logToFile = true) {
            console.warn(msg);

            if (logToFile) {
                fsp.appendFile(LOG_FILE, `${new Date().toISOStringLocal(TZ)} : warn : ${msg}\n`)
                    .catch(e => warn(e, false));
            }
        };
        const warnRetCar = function (what, err, logToFile = true) {
            warn(`Unable to retreive ${what} from Carrier - ${err}`, DEBUG && logToFile);
        };

        const writeIFile = (file, data, encoding = 'utf8') => {

            const writeDataFile = (dfile, data, encoding) => {
                fsp.writeFile(dfile, data, encoding)
                    .catch(e => error(`Unable to save ${dfile} ${e}`));
            }

            const DATA_FILE = DATA_DIR + file;

            var parts = file.split('/');
            var key = parts[parts.length - 1].split('.')[0];

            if (KEEP_HISTORY && !HISTORY_EXCLUSIONS_ARR.includes(key)) {
                const dt = new Date().toISOStringLocal(TZ).replace(/:/g, '-').replace('T', '_').replace('Z', '');
                const HIST_FILE = `${DATA_HISTORY_DIR}${key}_${dt}.xml`;

                const writeHistoryFile = (hf, d, enc) => {
                    fsp.writeFile(hf, d, enc)
                        .catch(e => error(`Unable to save ${HIST_FILE} - ${e}`));
                }

                if (KEEP_HISTORY_ON_CHANGE) {
                    fsp.readFile(DATA_FILE, 'utf8')
                        .then(fd => {
                            if (fd !== data) {
                                writeHistoryFile(HIST_FILE, data, encoding);
                            }

                            writeDataFile(DATA_FILE, data, encoding);
                        })
                        .catch(e => {
                            error(`Unable to read file ${file} - ${e}`);
                            writeHistoryFile(HIST_FILE, data, encoding);
                            writeDataFile(DATA_FILE, data, encoding);
                        });
                } else {
                    writeHistoryFile(HIST_FILE, data, encoding);
                    writeDataFile(DATA_FILE, data, encoding);
                }
            } else {
                writeDataFile(DATA_FILE, data, encoding);
            }
        }
        const readIFile = (file, encoding = 'utf8') => fsp.readFile(DATA_DIR + file, encoding);


        const notify = (name, data, specEventData = null, specBroadcastData = null) => {
            infinium.eventEmitter.emit(name, specEventData ? specEventData : data);
            infinium.eventEmitter.emit('update', name, data);

            if (infinium.ws) {

                infinium.ws.broadcast(`/ws/${name}`,
                    specBroadcastData ? specBroadcastData :
                        (specEventData ? specEventData : data)
                );

                infinium.ws.broadcast(`/ws/update`, specBroadcastData ? specBroadcastData : {
                    id: name,
                    data: data
                });
            } else {
                debug('broadcast not enabled');
            }
        };

        const jpath = (p) => path.join(__dirname, p);

        const cache = new WebFileCache({ cacheDir: CACHE_DIR, forwardInterval: FORWARD_INTERVAL });
        const server = express();

        infinium.eventEmitter = new events.EventEmitter();
        infinium.running = false;
        infinium.changes = false;
        infinium.loading = true;
        infinium.sendStatusToCarrier = 0;

        infinium.log = {
            debug: debug,
            error: error,
            warn: warn
        }


        //Updaters
        infinium.updateStatus = function (newStatus, loading = false) {
            const process = (xmlNewStatus, jsonNewStatus) => {
                return new Promise((resolve, reject) => {

                    const processJson = async (jsonNewStatus) => {
                        infinium.status = jsonNewStatus;

                        const status = utils.adjustIds(infinium.status, true);
                        notify('status', status, status.status);


                        resolve(loading ? 'Status Loaded' : infinium.status);
                    };

                    infinium.xmlStatus = xmlNewStatus;

                    if (!loading) {
                        writeIFile(STATUS_XML, infinium.xmlStatus);
                    }

                    (jsonNewStatus) ?
                        processJson(jsonNewStatus) :
                        parseXml2Json(xmlNewStatus)
                            .then(jsonNewStatus => processJson(jsonNewStatus))
                            .catch(e => reject(e));
                });
            };

            const processXml = (newStatus) => {
                return new Promise((resolve, reject) => {
                    buildXml(newStatus)
                        .then(xmlStatus => {
                            resolve(process(xmlStatus, newStatus));
                        })
                        .catch(e => {
                            reject(e);
                        })
                });
            }

            return (typeof newStatus === 'string') ?
                process(newStatus) :
                processXml(newStatus);
        }

        infinium.updateSystem = function (newSystem, loading = false) {
            const process = (xmlNewSystem, jsonNewSystem) => {
                return new Promise((resolve, reject) => {

                    const processJson = async (jsonNewSystem) => {
                        infinium.system = jsonNewSystem;

                        if (!loading) {
                            infinium.updateConfig(utils.clone(infinium.system.system));
                            resolve(infinium.system);
                        } else {
                            resolve('System Loaded');
                        }
                    };

                    infinium.xmlSystem = xmlNewSystem;

                    if (!loading) {
                        writeIFile(SYSTEM_XML, infinium.xmlSystem)
                    }

                    (jsonNewSystem) ?
                        processJson(jsonNewSystem) :
                        parseXml2Json(xmlNewSystem)
                            .then(jsonNewSystem => processJson(jsonNewSystem))
                            .catch(e => reject(e));
                });
            };

            const processXml = (newSystem) => {
                return new Promise((resolve, reject) => {
                    buildXml(newSystem)
                        .then(xmlSystem => {
                            resolve(process(xmlSystem, newSystem));
                        })
                        .catch(e => {
                            reject(e);
                        })
                });
            }

            return (typeof newSystem === 'string') ?
                process(newSystem) :
                processXml(newSystem);
        }

        infinium.updateConfig = function (newConfig, loading = false, fromCarrier = false) {
            const process = (xmlNewConfig, jsonNewConfig) => {
                return new Promise((resolve, reject) => {

                    const processJson = async (jsonNewConfig) => {
                        infinium.config = jsonNewConfig;

                        const config = utils.adjustIds(infinium.config, true);
                        notify('config', config, config.config);

                        resolve(loading ? 'Config Loaded' : infinium.config);
                    };

                    infinium.xmlConfig = xmlNewConfig;

                    if (!loading) {
                        writeIFile(CONFIG_XML, infinium.xmlConfig);
                    }

                    (jsonNewConfig) ?
                        processJson(jsonNewConfig) :
                        parseXml2Json(xmlNewConfig)
                            .then(jsonNewConfig => processJson(jsonNewConfig))
                            .catch(e => reject(e));
                });
            };

            const processXml = (newConfig) => {
                return new Promise((resolve, reject) => {
                    buildXml(newConfig)
                        .then(xmlConfig => {
                            resolve(process(xmlConfig, newConfig));
                        })
                        .catch(e => {
                            reject(e);
                        })
                });
            }

            if (typeof newConfig === 'string') {
                if (fromCarrier && !changes) {
                    parseXml2Json(newConfig)
                        .then(jsonNewConfig => {
                            if (jsonNewConfig.status.serverHasChanges === 'true') {
                                infinium.changes = true;
                                jsonNewConfig.status.pingRate = 12;
                                infinium.sendStatusToCarrier = new Date().getTime();

                                return processXml(jsonNewConfig);
                            } else {
                                return process(newConfig);
                            }
                        })
                        .catch(e => reject(e));
                } else {
                    return process(newConfig);
                }
            } else {
                return processXml(newConfig);
            }
        }

        infinium.applySystemChanges = function (system) {
            return new Promise((resolve, reject) => {
                infinium.updateSystem(system)
                    .then(_ => {
                        infinium.changes = true;
                        resolve('Applied Changes to System');
                    })
                    .catch(e => reject(e));
            });
        }


        //Express Start/Stop
        infinium.startServer = function () {
            if (!infinium.running) {
                server.listen(PORT, () => {
                    infinium.running = true;

                    debug(`Listening on port ${PORT}`, true, true);

                    if (KEEP_HISTORY) {
                        debug(`Keep History Enabled: '${DATA_HISTORY_DIR}'`, true, true);
                    }

                    if (DEBUG) {
                        debug('Debug Mode Enabled');
                    }

                    if (API_ENABLED) {
                        debug(`REST API Enabled`, true, true);
                    }

                    if (WS_ENABLED) {
                        debug(`Websockets Enabled`, true, true);
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
        readIFile(CONFIG_XML)
            .then(data => infinium.updateConfig(data, true))
            .then(msg => debug(msg))
            .catch(e => warn(e));

        readIFile(SYSTEM_XML)
            .then(data => infinium.updateSystem(data, true))
            .then(msg => debug(msg))
            .catch(e => warn(e));

        readIFile(STATUS_XML)
            .then(data => infinium.updateStatus(data, true))
            .then(msg => debug(msg))
            .catch(e => warn(e));


        //server
        server.use(bodyparser.json());
        server.use(bodyparser.urlencoded({ extended: true }));

        /* Thermostat Requests */
        server.get('/Alive', (req, res) => {
            debug('Sending Alive');
            res.send('alive');
        });

        server.get('/time', (req, res) => {
            debug('Sending Time');
            res.send(xmlBuilder.buildObject({
                time: {
                    $: {
                        "version": "1.9"
                    },
                    utc: new Date().toISOString()
                }
            }));
        });


        //Thermostat retreiving manifest
        server.get('/manifest', (req, res) => {
            debug('Retreiving Manifest');
            cache.get({
                request: utils.copyRequest(req),
                forwardInterval: ONE_HOUR,
                timeout: CARRIER_REQUEST_TIMEOUT
            })
                .then(cres => {
                    debug(`Sending Manifest from ${(cres.fromWeb ? 'Carrier' : 'Cache')}`);
                    res.send(cres.data);

                    writeIFile('manifest.xml', cres.data);

                    parseXml2Json(cres.data)
                        .then(obj => {
                            notify('manifest', obj);
                        })
                        .catch(e => {
                            error(e);
                        });
                })
                .catch(e => {
                    warnRetCar('Manifest', e);
                    res.send('');
                });
        });

        //Thermostat retreiving release notes
        server.get('/releaseNotes/:id', (req, res) => {
            debug('Retreiving Release Notes');

            var fileName = 'releaseNotes.txt';

            if (req.path) {
                var parts = req.path.split('/');
                fileName = parts[parts.length - 1];
            }

            cache.get({
                request: utils.copyRequest(req),
                fileName: DATA_DIR + fileName,
                forwardInterval: ONE_HOUR,
                timeout: CARRIER_REQUEST_TIMEOUT
            })
                .then(cres => {
                    notify('release_notes', cres.data);
                })
                .catch(e => warnRetCar('Release Notes', e));

            debug('Sending Release Notes');
            res.send('WARNING: Upgrading firmware may cause Infinium to stop working');
        });

        //Thermostat retreiving firmware
        server.get('/updates/:key', (req, res) => {
            debug('Retreiving System Firmware');

            var fileName = 'system-update.hex';

            if (req.path) {
                var parts = req.path.split('/');
                fileName = parts[parts.length - 1];
            }

            // var reqMod = utils.copyRequest(req);
            // reqMod.encoding = 'binary'

            // cache.get({ request: reqMod, fileName: DATA_DIR + fileName, timeout: CARRIER_REQUEST_TIMEOUT })
            //     .then(cres => {
            //         notify('system_update', {
            //             notice: 'System is trying to update itself. Check manifest for details.',
            //             url: utils.buildUrlFromRequest(req),
            //             fileName: fileName
            //         });
            //     })
            //     .catch(e => warnRetCar('System Firmware', e));

            notify('system_update', {
                notice: 'System is trying to update itself. Check manifest for details.',
                url: utils.buildUrlFromRequest(req),
                fileName: fileName
            });

            res.status(200).end();
        });


        //Thermostat checking for changes
        server.get('/systems/:id/config', (req, res) => {
            var sendFromCarrier = false;
            if (infinium.xmlConfig) {
                debug('Sending config.xml');
                res.send(infinium.xmlConfig);
                this.changes = false;
            } else if (infinium.xmlSystem) {
                debug('Sending config from system.xml');
                buildXml({
                    config: infinium.system.system.config
                })
                    .then(xml => {
                        res.send(xml);
                        this.changes = false;
                    })
                    .catch(e => {
                        res.send('');
                        error(`Failed to build config from systems - ${e}`)
                    });
            } else {
                sendFromCarrier = true;
            }

            cache.get({
                request: utils.copyRequest(req),
                fileName: DATA_DIR + CONFIG_XML,
                refresh: sendFromCarrier,
                timeout: CARRIER_REQUEST_TIMEOUT,
                forwardInterval: ONE_HOUR
            })
                .then(cres => {
                    debug('Retreived Config from Carrier');

                    infinium.updateConfig(cres.data, false, true).then(config => {
                        if (sendFromCarrier) {
                            res.send(config ? config : '');
                            this.changes = false;
                        }
                    });
                })
                .catch(e => {
                    if (sendFromCarrier) {
                        res.send('');
                    }
                    warnRetCar('Config', e);
                });
        });

        //Thermostat requesting system
        server.get('/systems/:id', (req, res) => {
            if (infinium.xmlSystem) {
                debug('Sending system.xml');
                res.send(infinium.xmlSystem);
            } else {
                debug('system.xml not found');
                res.send('');
            }
        });

        //Thermostat reporting system
        server.post('/systems/:id', (req, res) => {
            debug('Receiving system.xml');
            res.send('');

            if (req.body.data) {
                infinium.updateSystem(req.body.data)
                    .catch(e => error(e));
            }

            cache.get({ request: utils.copyRequest(req) })
                .catch(e => warnRetCar('(system) Response', e));
        });

        //Thermostat reporting status
        server.post('/systems/:system_id/status', (req, res) => {
            debug('Receiving status.xml');
            const now = new Date().getTime();

            if (req.body.data) {
                infinium.updateStatus(req.body.data)
                    .catch(e => error(e));
            }

            var buildResponse = () => {
                try {
                    return xmlBuilder.buildObject({
                        status: {
                            $: '1.37',
                            configHasChanges: infinium.changes ? 'true' : 'false',
                            serverHasChanges: infinium.changes ? 'true' : 'false',
                            pingRate: infinium.changes ? 20 : 12
                        }
                    });
                } catch (e) {
                    error(`Error building status response - ${e}`);
                    return '';
                }
            }

            if (infinium.sendStatusToCarrier && now > infinium.sendStatusToCarrier) {
                cache.get({ request: utils.copyRequest(req), refresh: true })
                    .then(cres => {
                        parseXml2Json(cres.data)
                            .then(obj => {
                                var changes = obj.status.serverHasChanges === 'true';
                                obj.status.pingRate = changes ? 20 : 12;

                                buildXml(obj)
                                    .then(xml => {

                                        infinium.statusResponse = xml;
                                        infinium.statusResponseReceived = new Date().getTime();

                                        debug('Received Status Response from Carrier. Pending Send');
                                    })
                                    .catch(e => {
                                        res.send('');
                                        error(`Error building status response - ${e}`);
                                    });
                            })
                            .catch(e => {
                                error('Received Status Response from Carrier but it Failed to parse.');
                            });

                        infinium.sendStatusToCarrier = now + FORWARD_INTERVAL;
                    })
                    .catch(e => warnRetCar('Status Reponse', e));
            }


            if (infinium.statusResponse && infinium.statusResponseReceived
                && (now - infinium.statusResponseReceived) < ONE_MIN) {
                res.send(infinium.statusResponse);
                infinium.statusResponse = null;
                infinium.statusResponseReceived = 0;
                debug(`Sending (Carrier) Status Response - Changes: ${infinium.changes.toString()}`);
            } else {
                res.send(buildResponse());
                debug(`Sending Status Response - Changes: ${infinium.changes.toString()}`);
            }
        });


        //Thermostat requesting other data
        server.get('/systems/:system_id/:key', (req, res) => {
            const key = req.params.key;
            debug(`Retreiving ${req.params.key}`)

            cache.get({ request: utils.copyRequest(req), forwardInterval: ONE_HOUR, timeout: CARRIER_REQUEST_TIMEOUT })
                .then(cres => {
                    if (cres.error) {
                        warnRetCar(`(${key}) Response`, e);
                        debug(`Sending Cached ${key} Response due to request error`);
                    } else {
                        debug(`Sending ${key} Response from Carrier`);
                        writeIFile(`${key}.xml`, cres.data);
                    }

                    res.send(cres.data);

                    if (cres.fromWeb) {
                        parseXml2Json(cres.data)
                            .then(obj => {
                                var data = utils.adjustIds(obj);

                                notify(key, data, null, {
                                    id: key,
                                    data: data,
                                    response: true
                                });
                            })
                            .catch(e => error(`Failed to parse: [GET] ${key} - ${e}`))
                    }
                })
                .catch(e => {
                    warnRetCar(`(${key}) Response`, e);
                    debug(`Respoing to ${key} request with generated response`);
                    res.send(utils.getEmptyCarrierResponse(key));
                });
        });

        //Thermostat reporting other data
        server.post('/systems/:system_id/:key', (req, res) => {
            const key = req.params.key;
            debug(`Receiving ${key}.xml`);

            if (req.body.data) {
                parseXml2Json(req.body.data)
                    .then(obj => {
                        notify(key, utils.adjustIds(obj));
                    })
                    .catch(e => error(`Failed to parse: ${key} - ${e}`));

                writeIFile(`${key}.xml`, req.body.data);
            }

            cache.get({ request: utils.copyRequest(req), forwardInterval: ONE_HOUR })
                .then(cres => {
                    if (cres.error) {
                        warnRetCar(`(${key}) Response`, e);
                        debug(`Sending Cached ${key} Response due to request error`);
                    } else {
                        debug(`Sending ${key} Response from Carrier [POST] ${req.path}`);
                    }

                    res.send(cres.data);
                })
                .catch(e => {
                    warnRetCar(`(${key}) Response`, e);
                    res.send('');
                });
        });


        //Thermostat retreiving weather forecast
        server.get('/weather/:zip/forecast', (req, res) => {
            var now = new Date().getTime();

            const sendCachedWeather = () => {
                res.send(infinium.xmlWeather ? infinium.xmlWeather : '');
            };

            const updateWeather = async (xmlWeather) => {
                if (typeof xmlWeather === 'string') {
                    infinium.xmlWeather = xmlWeather;
                    infinium.lastWeatherUpdate = now;

                    writeIFile('weather.xml', xmlWeather);

                    parseXml2Json(xmlWeather)
                        .then(obj => {
                            var data = utils.adjustIds(obj);

                            notify('weather', data, null, {
                                id: 'weather',
                                data: data,
                                response: true
                            });
                        })
                        .catch(e => error(`Failed to parse: weather - ${e}`));
                } else {
                    error('Invalid weather format');
                }
            };

            if (!infinium.lastWeatherUpdate || ((now - infinium.lastWeatherUpdate) > WEATHER_REFRESH_RATE)) {
                debug(`Retreiving Weather Data from ${infinium.weatherProvider.getName()}`)

                const weather = infinium.weatherProvider.getWeather(utils.copyRequest(req));

                if (weather instanceof Promise) {
                    weather
                        .then(xmlWeather => {
                            debug(`Sending Weather Data from ${infinium.weatherProvider.getName()}`);
                            updateWeather(xmlWeather)
                            res.send(xmlWeather);
                        })
                        .catch(e => {
                            error(`Unable to retrieve weather (${infinium.weatherProvider.getName()}) - ${e}`);
                        });
                } else if (typeof weather === 'string') {
                    res.send(weather);
                    updateWeather(weather);
                } else {
                    error(`Unable to retrieve weather (${infinium.weatherProvider.getName()}) - ${err}`);
                    sendCachedWeather();
                }
            } else if (infinium.xmlWeather) {
                debug(`Sending Cached Weather Data from ${infinium.weatherProvider.getName()}`);
                sendCachedWeather();
            }
        });


        //Infinium REST API
        if (API_ENABLED) {
            //Get System Status
            server.get('/api/status', (req, res) => {
                if (infinium.status) {
                    res.json(utils.adjustIds(infinium.status.status));
                } else {
                    res.send('Status Not Available');
                }
            });

            //Get System Config
            server.get('/api/config', (req, res) => {
                if (infinium.config) {
                    res.json(utils.adjustIds(infinium.config.config));
                } else {
                    res.send('Config Not Available');
                }
            });

            //Get activity of a Zone
            server.get('/api/activity/:activity', (req, res) => {
                var zone = 1;

                if (!infinium.system) {
                    res.send('System not ready');
                } else if (req.query.zone && !(zone = utils.validateZone(req.query.zone))) {
                    res.send('Invalid Zone');
                } else if (!Activities.All.includes(req.params.activity.toLowerCase())) {
                    res.send('Invalid Activity');
                } else {
                    var activity = utils.getActivity(infinium.system, zone, req.params.activity);

                    if (activity) {
                        res.json(utils.adjustIds(activity));
                    } else {
                        res.send('Actvity not Found');
                    }
                }
            });

            //Get Schedule for a Zone (Option for Specific Day)
            server.get('/api/schedule', (req, res) => {
                var zone = 1;

                if (!infinium.system) {
                    res.send('System not ready');
                } else if (req.query.zone && !(zone = utils.validateZone(req.query.zone))) {
                    res.send('Invalid Zone');
                } else if (req.query.day && !utils.validateDay(req.query.day)) {
                    res.send('Invalid Day');
                } else {
                    const schedule = (req.query.day) ?
                        utils.getDay(utils.getZone(infinium.system, zone).program, req.query.day) :
                        schedule = utils.getZone(infinium.system, zone).program;

                    if (schedule) {
                        res.json(utils.adjustIds(schedule, true));
                    } else {
                        res.send('Schedule not found');
                    }
                }
            });

            //Get all data for a Zone
            server.get('/api/zone/:zone', (req, res) => {
                var zone;

                if (!infinium.system) {
                    res.send('System not ready');
                } else if (!(zone = utils.validateZone(req.params.zone))) {
                    res.send('Invalid Zone');
                } else {
                    zone = utils.adjustIds(utils.getZone(this.system, zone));

                    if (zone) {
                        res.json(utils.adjustIds(zone, true));
                    } else {
                        res.send('Zone not found');
                    }
                }
            });


            //Set an Activity for a Zone
            server.post('/api/activity/:activity', (req, res) => {
                if (req.params.activity && (req.body.clsp || req.body.htsp || req.body.fan)) {
                    this.setActivity(req.body.zone || 1, req.params.activity,
                        req.body.clsp || null,
                        req.body.htsp || null,
                        req.body.fan || null)
                        .then(activity => {
                            debug(`Activity has been set from: ${req.connection.remoteAddress}`)
                            res.send(activity);
                        })
                        .catch(e => {
                            res.send(e);
                        });
                } else {
                    res.send('Invalid Parameters');
                }
            });

            //Set a Hold for a Zone
            server.post('/api/hold', (req, res) => {
                this.setHold(req.body.zone || 1, req.body.hold || true, req.body.activity || 'home', req.body.holdUntil || null)
                    .then(zone => {
                        debug(`Hold has been set from: ${req.connection.remoteAddress}`);
                        res.send(zone);
                    })
                    .catch(e => {
                        res.send(e);
                    });
            });

            //Set a Schedule for a Zone
            server.post('/api/schedule', (req, res) => {
                if (req.body.schedule) {
                    this.setSchedule(req.body.zone || 1, JSON.parse(req.body.schedule),
                        (err, system) => {
                            if (err) {
                                res.send(err);
                                warn(err);
                            } else {
                                debug(`Schedule has been updated from: ${req.connection.remoteAddress}`);
                                res.send('sucess');
                            }
                        });
                } else {
                    res.send('Invalid Parameters');
                }
            });
        }

        //Infinium Websockets
        if (WS_ENABLED) {
            infinium.ws = {};
            infinium.ws.server = expressWS(server);

            infinium.ws.broadcast = (path, data) => {
                try {
                    var clients = infinium.ws.server.getWss().clients

                    if (clients && clients.size > 0) {
                        clients = Array.from(clients).filter(s => {
                            return s.route === path;
                        });


                        if (clients.length > 0) {

                            clients.forEach((client) => {
                                client.send(JSON.stringify(data));
                            });

                            debug(`WS Sending '${path}' to ${clients.length} client${clients.length > 1 ? 's' : ''}`);
                        }
                    }
                } catch (e) {
                    error(`WS Broadcast (${path}) ${e}`);
                }
            }

            //Listen for System Status
            server.ws(WS_STATUS, (ws, req) => {
                ws.route = WS_STATUS;

                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_STATUS}`);
                });

                debug(`Client connected to ${WS_STATUS}`);
            });

            //Listen for System Config Change
            server.ws(WS_CONFIG, (ws, req) => {
                ws.route = WS_CONFIG;

                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_CONFIG}`);
                });

                debug(`Client connected to ${WS_CONFIG}`);
            });

            //Listen for everything else
            server.ws(WS_UPDATE, (ws, req) => {
                ws.route = WS_UPDATE;

                ws.on('close', () => {
                    debug(`Client disconnected from ${WS_UPDATE}`);
                });

                debug(`Client connected to ${WS_UPDATE}`);
            });

            //Listen for a specific type of data
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

        //Catch for all other requests
        server.all('/:key', (req, res) => {
            var msg = `Unknown Request${req.method ? ` (${req.method})` : ''}: /${req.params['key']}`;
            debug(msg, true, true);
            res.statusMessage = "Invalid Request";
            res.status(400).end();
        });

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


        if (KEEP_HISTORY && !fs.existsSync(DATA_HISTORY_DIR)) {
            try {
                fs.mkdirSync(DATA_HISTORY_DIR, { recursive: true });
            } catch (e) {
                error(`Unable to create ${DATA_HISTORY_DIR}: ${e}`);
            }
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


    setHold(zone, hold = true, activity = 'home', holdUntil = null) {
        const infinium = this;
        return new Promise((resolve, reject) => {
            if (infinium.system) {
                var czone;
                if (czone = utils.validateZone(zone)) {
                    if (typeof hold === 'boolean' || hold === 'on' || hold === 'off') {
                        if (Activities.All.includes(activity)) {
                            if (utils.validateTime(holdUntil)) {
                                var system = utils.clone(infinium.system);
                                var szone = utils.getZone(system, czone);

                                if (szone) {
                                    szone.hold = ((typeof hold === 'boolean') ? (hold === true ? 'on' : 'off') : hold);
                                    szone.holdActivity = activity;
                                    szone.otmr = (holdUntil) ? holdUntil : '';

                                    infinium.applySystemChanges(system)
                                        .then(result => {
                                            infinium.log.debug(`Hold Set (${
                                                czone
                                                },${
                                                activity
                                                },${
                                                szone.hold
                                                },${
                                                holdUntil ? holdUntil : '*'
                                                })`, true, true);

                                            resolve(utils.adjustIds(szone));
                                        })
                                        .catch(e => {
                                            error(`Error making changes to System - ${e}`);
                                            reject('Error making changes to System');
                                        });
                                } else {
                                    reject('Can not find zone in config');
                                }
                            } else {
                                reject(`Invalid Hold Until Value: ${holdUntil}`);
                            }
                        } else {
                            callback(`Invalid Activity Value: ${activity}`);
                        }
                    } else {
                        reject(`Invalid Hold Value: ${hold}`);
                    }
                } else {
                    reject(`Invalid Zone: ${zone}`);
                }
            } else {
                reject('System not ready.');
            }
        });
    }

    setActivity(zone, activity, clsp = null, htsp = null, fan = null) {
        const infinium = this;

        return new Promise((resolve, reject) => {
            if (infinium.system) {
                const system = utils.clone(infinium.system);
                var czone, cclsp, chtsp;

                if (czone = utils.validateZone(zone)) {
                    if (Activities.All.includes(activity)) {
                        if ((cclsp = utils.validateTemp(clsp, system.system.config.vacmint, system.system.config.vacmaxt)) !== 0) {
                            if ((chtsp = utils.validateTemp(htsp, system.system.config.vacmint, system.system.config.vacmaxt)) !== 0) {
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

                                        infinium.applySystemChanges(system)
                                            .then(result => {
                                                infinium.log.debug(`Activity Set (${czone},${activity}:${
                                                    cclsp ? cclsp : '*'
                                                    },${
                                                    chtsp ? chtsp : '*'
                                                    },${
                                                    fan ? fan : '*'
                                                    })`, true, true);

                                                resolve(utils.adjustIds(activity));
                                            })
                                            .catch(e => {
                                                error(`Error making changes to System - ${e}`);
                                                reject('Error making changes to System');
                                            });
                                    } else {
                                        reject('Can not find activity in config');
                                    }
                                } else {
                                    reject(`Invalid Fan Mode: ${fan}`);
                                }
                            } else {
                                reject(`Invalid Heating Setpoint: ${htsp}`);
                            }
                        } else {
                            reject(`Invalid Cooling Setpoint: ${clsp}`);
                        }
                    } else {
                        reject(`Invalid Avtivity Value: ${activity}`);
                    }
                } else {
                    reject(`Invalid Zone: ${zone}`);
                }
            } else {
                reject('System not ready');
            }
        });
    }

    setSchedule(zone, schedule) {
        const infinium = this;

        return new Promise((resolve, reject) => {
            var newSchedule;

            const processPeriod = function (currPeriod, newPeriod) {
                if (newPeriod.activity !== undefined) {
                    if (Activities.All.includes(newPeriod.activity)) {
                        currPeriod.activity = newPeriod.activity;
                    } else {
                        throw `Invalid Activity: ${newPeriod.activity}`;
                    }
                }

                if (newPeriod.time !== undefined) {
                    if (utils.validateTime(newPeriod.time)) {
                        currPeriod.time = newPeriod.time;
                    } else {
                        throw `Invalid Time: ${newPeriod.time}`;
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
                        throw `Invalid Enabled Value: ${enable}`;
                    }
                }
            }

            const processDay = (program, newDay) => {
                const currDay = utils.getDay(program, newDay.id);

                if (currDay && Array.isArray(currDay.period)) {
                    if (Array.isArray(newDay.periods)) {
                        newDay.periods.forEach(np => {
                            var npid;
                            if ((npid = utils.validatePeriod(np.id))) {
                                processPeriod(utils.getPeriod(currDay, npid.toString()), np);
                            } else {
                                throw `Invalid Period: ${np.id}`;
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
                                        throw 'Each period must take place after the one before it.';
                                    }

                                    prevPeriod = currPeriod;
                                }
                            }
                        }
                    } else {
                        throw 'Could not find periods in newDay';
                    }
                } else {
                    throw 'Could not find Day in config';
                }
            }

            if (Array.isArray(schedule)) {
                newSchedule = schedule;
            } else if (Array.isArray(schedule.schedule)) {
                newSchedule = schedule.schedule;
            } else {
                reject('Invalid Schedule');
                return;
            }

            var czone;
            if (infinium.system) {
                if ((czone = utils.validateZone(zone))) {
                    const system = utils.clone(infinium.system);
                    const program = utils.getZone(system, czone).program

                    try {
                        newSchedule.forEach(newDay => {
                            if (utils.validateDay(newDay.id)) {
                                processDay(program, newDay);
                            } else {
                                throw `Invalid Day: ${newDay.id}`;
                            }
                        });

                        infinium.applySystemChanges(system)
                            .then(result => {
                                infinium.log.debug(`Schedule for Zone ${czone} Updated`, true, true);
                                resolve(utils.adjustIds(program));
                            })
                            .catch(e => {
                                error(`Error making changes to System - ${e}`);
                                reject('Error making changes to System');
                            });
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(`Invalid Zone: ${zone}`);
                }
            } else {
                reject('System not ready.');
            }
        });
    }
}

module.exports = Infinium;