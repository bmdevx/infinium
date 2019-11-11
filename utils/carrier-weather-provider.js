const WeatherProvider = require('./weather-provider.js');
const request = require('request');

class CarrierWeatherProvier extends WeatherProvider {

    getWeather(req) {
        return new Promise((resolve, reject) => {
            const method = req.method;
            request(req, (err, res, data) => {
                if (!err) {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(`Request Status Error ${method ? `[${method}]` : ''}(${req.url}): ${res.statusCode}`);
                    }
                } else {
                    reject(`Request Weather Error - ${err}`);
                }
            });
        });
    }

    getName() {
        return 'Carrier';
    }
}

module.exports = CarrierWeatherProvier;