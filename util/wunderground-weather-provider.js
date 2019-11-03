const xml2js = require('xml2js');
const WeatherProvider = require('./weather-provider');
const WeatherUndergroundNode = require('./weather-underground-node');


const carrierWeatherMap = [
    'Thunderstorms',    //1
    'Sleet',            //2
    'Rain and Sleet',   //3
    'Wintry Mix',       //4
    'Rain and Snow',    //5
    'Snow',             //6
    'Freezing Rain',    //7
    'Rain',             //8
    'Blizzard',         //9
    'Fog',              //10
    'Cloudy',           //11
    'Partly Cloudy',    //12
    'Mostly Cloudy',    //13
    'Sunny'             //14
];

const wuIconToCarrier = [
    1,
    1,
    1,
    1,
    1,
    5,
    3,
    5,
    8,
    8,
    8,
    8,
    8,
    6,
    6,
    6,
    6,
    2,
    2,
    14,
    10,
    12,
    13,
    14,
    14,
    6,
    11,
    13,
    13,
    12,
    12,
    14,
    14,
    14,
    14,
    3,
    14,
    1,
    1,
    8,
    8,
    6,
    9,
    9,
    14,
    8,
    6,
    1
];

class WundergroundWeatherProvier extends WeatherProvider {
    constructor(config) {
        super();

        this.xmlBuilder = new xml2js.Builder();
        this.config = config;

        if (!config.apiKey) {
            throw 'No Wunderground API Key';
        } else if (!config.postalCode && !config.stationID && !(config.geoCode && config.geoCode.lat && config.geoCode.lon)) {
            throw 'No Wunderground Postal, Station or Geocode';
        }

        this.wunderground = new WeatherUndergroundNode(config.apiKey);
    }

    init(req) {

    }

    getWeather(callback) {
        const xmlBuilder = this.xmlBuilder;
        var processData = function (err, data) {
            var getStatus = function (index) {
                index = index > 0 ? ((index * 2) - 1) : 0;

                var code = data.daypart[0].iconCode[index];
                if (typeof code !== 'number') {
                    code = data.daypart[0].iconCode[index + 1]
                }

                var pop = data.daypart[0].precipChance[index];
                if (typeof pop !== 'number') {
                    pop = data.daypart[0].precipChance[index + 1];
                }

                var id = wuIconToCarrier[code];

                return {
                    id: id,
                    msg: carrierWeatherMap[id - 1],
                    pop: pop
                };
            };

            if (!err) {
                var i, weather = [];
                for (i = 0; i < 5; i++) {
                    var status = getStatus(i);

                    weather.push({
                        $: { "id": data.dayOfWeek[i] },
                        timestamp: data.validTimeLocal[i],
                        min_temp: {
                            $: "units=f",
                            _: data.temperatureMin[i]
                        },
                        max_temp: {
                            $: "units=f",
                            _: data.temperatureMax[i]
                        },
                        status_id: status.id,
                        status_message: status.msg,
                        pop: status.pop
                    })
                }

                var weatherConfig = {
                    weather_forecast: {
                        $: {
                            "xmlns:atom": "http://www.w3.org/2005/Atom",
                            "version": "1.42"
                        },
                        'atom:link': {
                            $: {
                                "rel": "self",
                                "href": "http://www.api.ing.carrier.com/weather/80526/forecast"
                            }
                        },
                        'atom:link': {
                            $: {
                                "rel": "http://www.api.ing.carrier.com/rels/weather",
                                "href": "http://www.api.ing.carrier.com/weather/80526"
                            }
                        },
                        timestamp: new Date().toISOString(),
                        ping: 240,
                        days: weather
                    }
                }

                try {
                    callback(null, xmlBuilder.buildObject(weatherConfig));
                } catch (e) {
                    callback(e);
                }
            } else {
                callback(err);
            }
        };

        if (this.config.postalCode) {
            this.wunderground.ForecastDaily()
                .FiveDay()
                .ByPostalCode(this.config.postalCode, this.config.countryCode || "US")
                .Language("en-US")
                .request(processData);
        } else if (this.config.geoCode) {
            this.wunderground.ForecastDaily()
                .FiveDay()
                .ByGeocode(this.config.geoCode.lat, this.config.geoCode.lon)
                .Language("en-US")
                .request(processData);
        }
    }

    getName() {
        return 'Wunderground';
    }
}

module.exports = WundergroundWeatherProvier;