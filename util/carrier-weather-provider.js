const WeatherProvider = require('./weather-provider');

const request = require('request');

class CarrierWeatherProvier extends WeatherProvider {

    init(request) {
        this.req = request;
    }

    getWeather(callback) {
        request(this.req, (err, res, data) => {
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