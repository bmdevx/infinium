const WeatherProvider = require('./weather-provider');

const request = require('request');

class CarrierWeatherProvier extends WeatherProvider {

    getWeather(req, callback) {
        request(req, (err, res, data) => {
            if (!err) {
                if (res.statusCode === 200) {
                    callback(null, data);
                } else {
                    callback(`Request Status Error: ${res.statusCode}`);
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