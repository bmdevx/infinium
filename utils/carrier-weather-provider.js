const WeatherProvider = require('./weather-provider.js');
const request = require('request');

class CarrierWeatherProvier extends WeatherProvider {

    getWeather(req, callback) {
        const method = req.method;
        request(req, (err, res, data) => {
            if (!err) {
                if (res.statusCode === 200) {
                    callback(null, data);
                } else {
                    callback(`Request Status Error ${method ? `[${method}]` : ''}(${req.url}): ${res.statusCode}`);
                }
            } else {
                callback(err);
            }
        });
    }

    getName() {
        return 'Carrier';
    }
}

module.exports = CarrierWeatherProvier;