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

    
    static getZone(system, zone) {
        return system.config.zones.find(z => {
            return z.$ && z.$.id === zone
        });
    }
    
    static getActivity(system, zone, activityName) {
        return getZone(system, zone).activities.find(a => {
            return a.$ && a.$.id === activityName
        });
    }
    
    static getSchedule(system, zone, day) {
        return getZone(system, zone).program.find(d => {
            return d.$ && d.$.id === day
        });
    }
}

module.exports = utils;