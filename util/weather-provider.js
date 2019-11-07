class WeatherProvider {
    constructor() {
        if (!this.getWeather || !this.getName) {
            throw 'Invalid Weather Provider';
        }
    }
}

module.exports = WeatherProvider;