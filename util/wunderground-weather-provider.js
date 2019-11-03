const WeatherProvider = require('./weather-provider');
const WeatherUndergroundNode = require('wundergroundnode');

class WundergroundWeatherProvier extends WeatherProvider {
    constructor(config) {
        this.config = config;

        if (!config.apiKey) {
            throw 'No Wunderground API Key';
        } else if (!config.zipCode && !config.stationID && !(config.geoCode && config.geoCode.lat && config.geoCode.lon)) {
            throw 'No Wunderground Postal, Station or Geocode';
        }

        this.wunderground = new WeatherUndergroundNode(config.apiKey);
    }

    init(req) {

    }

    getWeather(callback) {
        var parseResponse = function (err, data) {
            var wuWeather = JSON.parse(data);


        }

        if (this.config.zipCode) {
            wunderground.ForecastDaily()
                .FiveDay()
                .ByPostalCode(this.config.zipCode, "EN")
                .request(parseResponse);
        } else if (this.config.geoCode) {
            wunderground.ForecastDaily()
                .FiveDay()
                .ByGeocode(this.config.geoCode.lat, this.config.geoCode.lon)
                .request(parseResponse);
        }
    }

    getName() {
        return 'Wunderground';
    }
}

module.exports = WundergroundWeatherProvier;