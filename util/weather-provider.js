class WeatherProvider {
    constructor() {
        if (!this.getWeather || !this.init || !this.getName) {
            throw 'Invalid Weather Provider';
        }
    }
}

module.exports = WeatherProvider;