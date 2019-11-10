class utils {
    static validateZone(zone) {
        return ((Number.isInteger(zone) || (typeof (zone = parseInt(zone)) === 'number')) &&
            !isNaN(zone) && zone > 0 && zone < 9) ? zone : 0;
    }

    static validateTemp(temp, systemMinTemp, systemMaxTemp) {
        return (temp === null || ((Number.isInteger(temp) || (typeof (temp = parseInt(temp)) === 'number')) &&
            !isNaN(temp) && temp >= systemMinTemp && temp <= systemMaxTemp)) ? temp : 0;
    }

    static validateTime(time) {
        if (typeof time === 'string') {
            var parts = time.split(':');
            if (parts.length === 2 && parts[0].length === 2 && parts[1].length === 2) {
                var hh = parseInt(parts[0]);
                var mm = parseInt(parts[1]);

                return (!isNaN(hh) && hh >= 0 && hh < 24 && !isNaN(mm) && mm % 15 == 0 && mm >= 0 && mm < 60);
            }
        } else if (time === null) {
            return true;
        }

        return false;
    };

    static validateDay(day) {
        return (typeof day === 'string') &&
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(day.toLowerCase());
    }

    static validatePeriod(period) {
        return ((Number.isInteger(period) || (typeof (period = parseInt(period)) === 'number')) &&
            !isNaN(period) && period > 0 && period < 6) ? period : 0;
    }


    static getZone(system, zone) {
        return (system.system ? system.system : system).config.zones.zone.find(z => {
            return z.$ && this.validateZone(z.$.id) === zone
        });
    }

    static getActivity(system, zone, activityName) {
        return this.getZone(system, zone).activities.activity.find(a => {
            return a.$ && a.$.id === activityName
        });
    }

    static getSchedule(system, zone, day) {
        return this.getZone(system, zone).program.day.find(d => {
            return d.$ && d.$.id === day
        });
    }

    static getDay(program, dayId) {
        return program.day.find(d => {
            return d.$ && d.$.id.toLowerCase() === dayId.toLowerCase();
        });
    }

    static getPeriod(day, periodId) {
        return day.period.find(p => {
            return p.$ && p.$.id === periodId;
        });
    }

    static stringifyCirc(obj) {
        const getCircularReplacer = () => {
            const seen = new WeakSet();
            return (key, value) => {
                if (typeof value === "object" && value !== null) {
                    if (seen.has(value)) {
                        return;
                    }
                    seen.add(value);
                }
                return value;
            };
        };

        return JSON.stringify(obj, getCircularReplacer());
    };

    static clone(obj, strip$ = false) {
        var copy;

        // Handle the 3 simple types, and null or undefined
        if (null == obj || "object" != typeof obj) return obj;

        // Handle Date
        if (obj instanceof Date) {
            copy = new Date();
            copy.setTime(obj.getTime());
            return copy;
        }

        // Handle Array
        if (obj instanceof Array) {
            copy = [];
            for (var i = 0, len = obj.length; i < len; i++) {
                copy[i] = this.clone(obj[i]);
            }
            return copy;
        }

        // Handle Object
        if (obj instanceof Object) {
            copy = {};
            for (var attr in obj) {
                if (obj.hasOwnProperty(attr) && (!strip$ || attr !== '$'))
                    copy[attr] = this.clone(obj[attr]);
            }
            return copy;
        }

        throw new Error("Unable to copy obj! Its type isn't supported.");
    }

    static adjustIds(obj) {
        var copy;

        // Handle the 3 simple types, and null or undefined
        if (null == obj || "object" != typeof obj) return obj;

        // Handle Date
        if (obj instanceof Date) {
            copy = new Date();
            copy.setTime(obj.getTime());
            return copy;
        }

        // Handle Array
        if (obj instanceof Array) {
            copy = [];
            for (var i = 0, len = obj.length; i < len; i++) {
                copy[i] = this.adjustIds(obj[i]);
            }
            return copy;
        }

        // Handle Object
        if (obj instanceof Object) {
            copy = {};
            for (var attr in obj) {

                if (attr === '$') {
                    for (var $attr in obj[attr]) {
                        copy[$attr] = obj[attr][$attr];
                    }

                    delete obj.attr;
                } else if (obj.hasOwnProperty(attr)) {
                    copy[attr] = this.adjustIds(obj[attr]);
                }
            }
            return copy;
        }

        throw new Error("Unable to copy obj! Its type isn't supported.");
    }

    static copyRequest(req) {
        var creq = {
            url: this.buildUrlFromRequest(req),
            headers: req.headers,
            method: req.method
        }

        if (req.method === 'POST' && req.body) {
            creq.body = req.body ? (typeof req.body === 'object' ? JSON.stringify(req.body) : req.body) : undefined
        }

        if (req.protocol) {
            creq.protocol = req.protocol ? (req.protocol.includes(':') ? req.protocol : req.protocol + ':') : 'http:';
        }

        return creq;
    }

    static buildUrlFromRequest(req) {
        return `${req.protocol || 'http'}://${req.hostname || req.host}${req.baseUrl || req.path}`;
    }

    static getConfigVar(cv, ev, dv) {
        return cv !== undefined ? cv :
            (ev !== undefined ? ev : dv);
    }
}

//Local ISO Format
Date.prototype.toISOStringLocal = function (tzOffset) {
    return (typeof tzOffset === 'number' && tzOffset !== 0) ?
        new Date(this.getTime() + (tzOffset * 3600000)).toISOString().slice(0, -1) :
        new Date(this.getTime() - (this.getTimezoneOffset() * 60000)).toISOString().slice(0, -1);
}

module.exports = utils;