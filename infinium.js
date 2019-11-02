const express = require('express');
const bodyparser = require('body-parser');
const events = require('events');
const xml2js = require('xml2js');
const fs = require('fs');
const clone = require('./util/clone.js');
const WebFileCache = require('./util/web-file-cache.js.js');

const DEBUG_MODE = true;

const DEFAULT_LISTEN_PORT = 3000;
const DEFAULT_API_ENABLED = false;
const DEFAULT_FORWARD_INTERVAL = 15 * 60 * 1000; //in millis
const ONE_DAY_FORWARD_INTERVAL = 24 * 60 * 60 * 1000; //in millis

const XML_DIR = 'data/';
const CACHE_DIR = 'data/cache/';

const CONFIG_XML = XML_DIR + 'config.xml';
const STATUS_XML = XML_DIR + 'status.xml';
const SYSTEMS_XML = XML_DIR + 'systems.xml';

class Infinium {
    constructor(config = {}) {
        this.port = config.port || DEFAULT_LISTEN_PORT;
        this.apiEnabled = config.enableApi || DEFAULT_API_ENABLED;
        this.forwardInterval = config.forwardInterval || DEFAULT_FORWARD_INTERVAL;
        this.debugMode = config.debugMode || DEBUG_MODE;

        this.eventEmitter = new events.EventEmitter();
        const xmlBuilder = new xml2js.Builder();
        const parseXml2Json = xml2js.parseString;
        const cache = new WebFileCache({ cacheDir: CACHE_DIR, forwardInterval: this.forwardInterval });

        const server = express();

        this.changes = false;


        const debug = function (msg, trace = false) {
            if (this.debugMode || trace) {
                console.log(msg);
            }
        }

        const urlFilter = function (req, res, next) {
            next();

            // if (req.hostname.includes('carrier') || req.hostname.includes('bryant')) {
            //     next();
            // } else {
            //     console.log('Forwarding: ' + req.originalUrl);
            //     proxy.web(req, res, { target: req.originalUrl });
            // }
        };


        this.updateConfig = function (config, fromCarrier = false) {
            try {
                if (typeof config === 'string') {
                    config = parseXml2Json(config);
                }

                if (fromCarrier && !this.changes && config.status.serverHasChanges === 'true') {
                    this.changes = true;
                    config.status.pingRate = [12];
                    this.sendStatusToCarrier = new Date().getTime() + (2 * 60 * 1000);
                }

                this.xmlConfig = xmlBuilder.buildObject(config);
                this.config = tmpConfig;

                fs.writeFile(CONFIG_XML, this.xmlConfig, (err) => {
                    console.warn('Unable to save config.xml\n' + err);
                });

                this.eventEmitter.emit('config');
            } catch (e) {
                console.warn(e);
            }
        }

        this.updateStatus = function (status) {
            if (typeof status === 'string') {
                this.status = parseXml2Json(status);
                this.xmlStatus = status;
            } else {
                this.status = status;
                this.xmlStatus = xmlBuilder.buildObject(status);
            }

            fs.writeFile(STATUS_XML, this.xmlConfig, (err) => {
                console.warn('Unable to save status.xml\n' + err);
            });

            this.eventEmitter.emit('status', this.status);
        }

        this.updateSystems = function (systems, updateConfig = true) {
            if (typeof systems === 'string') {
                this.systems = parseXml2Json(systems);
                this.xmlSystems = systems;
            } else {
                this.systems = systems;
                this.xmlSystems = xmlBuilder.buildObject(systems);
            }

            if (updateConfig) {
                this.updateConfig(xmlBuilder.buildObject({
                    config: this.xmlSystems.system.config
                }));
            }

            fs.writeFile(SYSTEMS_XML, this.xmlSystems, (err) => {
                console.warn('Unable to save systems.xml\n' + err);
            });

            this.eventEmitter.emit('systems', this.systems);
        }


        //load configs if available
        fs.readFile(CONFIG_XML, 'utf8', (err, data) => {
            if (!err) {
                this.updateConfig(data);
            }
        });

        fs.readFile(STATUS_XML, 'utf8', (err, data) => {
            if (!err) {
                this.updateStatus(data);
            }
        });

        fs.readFile(SYSTEMS_XML, 'utf8', (err, data) => {
            if (!err) {
                this.updateSystems(data, false);
            }
        });

        //todo load other xml once parsed


        server.use(urlFilter);
        server.use(bodyparser.json());
        server.use(bodyparser.urlencoded({ extended: false }));


        server.get('/', (req, res) => {
            //main page
            res.send('');
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

            cache.get({ request: req, fileName: XML_DIR + 'relaseNotes.txt' }, (err, data, fromWeb) => {
                //ignore
            });

            res.send('WARNING: Upgrading firmware may cause Infinium to stop working');
        });

        server.get('/systems/:id', (req, res) => {
            if (this.xmlSystems) {
                debug('Sending systems.xml');
                res.send(this.xmlSystems);
            } else {
                debug('systems.xml not found');
                res.send('');
            }
        });

        //Thermostat checking for changes
        server.get('/systems/:id/config', (req, res) => {
            if (this.xmlConfig) {
                debug('Sending config.xml');
                res.send(this.xmlConfig);
            } else if (this.xmlSystems) {
                debug('Sending config from systems.xml');
                var xmlConfig = xmlBuilder.buildObject({
                    config: this.xmlSystems.system.config
                });
                res.send(xmlConfig);
            } else {
                cache.get({ request: req, fileName: 'config.xml' }, (err, data, fromWeb) => {
                    if (!err) {
                        this.updateConfig(data, true);
                    } else {
                        console.warn(err);
                    }
                });
            }
        });


        //Thermostat reporting system
        server.post('/systems/:id', (req, res) => {
            debug('Receiving systems.xml');

            if (req.body.data !== 'error') {
                this.updateSystems(req.body.data);
            }

            cache.get(req, (err, data, fromWeb) => {
                //ignore
            });

            res.send('');
        });

        //Thermostat reporting status
        server.post('/systems/:system_id/status', (req, res) => {
            debug('Receiving status.xml');

            if (req.body.data !== 'error') {
                this.updateStatus(req.body.data);

                var now = new Date().getTime();

                if (this.sendStatusToCarrier && now > this.sendStatusToCarrier) {
                    cache.get({ request: req, refresh: true }, (err, data, fromWeb) => {
                        if (!err) {
                            res.send(data);
                            this.sendStatusToCarrier = null;
                            debug('Received and Forwared Status Response from Carrier')
                        } else {
                            console.warn(err);
                        }
                    });
                } else {
                    var xml = xmlBuilder.buildObject({
                        status: {
                            $: '1.37',
                            configHasChanges: this.changes ? 'true' : 'false',
                            serverHasChanges: this.changes ? 'true' : 'false',
                            pingRate: this.changes ? 20 : 12

                        }
                    });

                    res.send(xml);

                    debug('Sent Status Response - Changes: ' + this.changes);
                    this.changes = false;
                }
            }
        });

        //Thermostat reporting other data
        server.post('/systems/:system_id/:key', (req, res) => {
            var key = req.params.key;
            debug(`Receiving ${key}.xml`);

            if (req.body.data !== 'error') {
                var data = req.body.data;

                fs.writeFile(XML_DIR + key + '.xml', data, (err) => {
                    console.warn(`Unable to save ${key}.xml\n` + err);
                });

                this.eventEmitter.emit('event', key, parseXml2Json(data));
            }

            cache.get(req, (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                } else {
                    console.warn(err);
                }
            });
        });



        server.get('/systems/manifest', (req, res) => {
            debug('Sending Manifest');
            cache.get(req, (err, data, fromWeb) => {
                if (!err) {
                    res.send(data);
                } else {
                    console.warn('manifest- ' + err);
                }
            });
        });


        server.get('/weather/:zip/forecast', (req, res) => {
            debug('Sending Weather Data');

        });

        server.get('/:key', (req, res) => {
            var msg = 'Unknown Request: ' + req.params['key'];
            debug(msg);
            res.send(msg);
        });


        if (this.apiEnabled) {
            //add api functions
        }


        this.server = server.listen(this.port, () => {

        });
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
}

module.exports = Infinium;