class utils {
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
}

module.exports = utils;