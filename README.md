# Infinium


### Infinium is a passive monitor and controller for Carrier Infinity Touch thermostats written using NodeJS


##### Features
  * Monitor all data in and out of an infinity system
  * Set and control the infinity touch control thermostat
  * Wunderground Support (Beta)
 

#### Works Using
  * Server Functions (work in progress)
  * REST API (work in progress)
  * WebSockets (work in progress)

### Config Example
```
{
    port: 3000,                 // Server Port
    wsEnabled: true,            // WebSockets Enabled
    apiEnabled: true,           // REST API Enabled
    forwardInterval: 900000,    // How often to forward data request to Carrier (in millis)
    weatherRefreshRate: 300000, // How often for weather module to update
    keepOtherHistory: false,    // Keep Timestamped config and data files
    debugMode: false,           // Enable Debugging in the logs
    
    // Optional. If not in config Infinium defaults to getting weather data from Carrier
    wunderground {
        apiKey: API_KEY,       // Currently requires a PWS
        
        // Postal | Zip Code Option
        postalCode: 1001,      // Zip Code
        countryCode: "US",     // If not in the US
        
        // Geo Location Option
        geoCode: {
            lat: 00.000,       // Latitude
            lon: 000.000       // Longitude
       }
    }
}
```

### Enviroment Variables
```
INFINIUM_PORT = 3000
INFINIUM_WS_ENABLED = true
INFINIUM_API_ENABLED = true
INFINIUM_KEEP_OTHER_HISTORY = false
INFINIUM_FORWARD_INTERVAL = 90000
INFINIUM_WEATHER_REFRESH_RATE = 90000
INFINIUM_DEBUG_MODE = false
```
### WebSocket
All data is in JSON Format
```
/ws/status      Gets Status
/ws/config      Gets Config
/ws/update      Gets all data in the format of { id: 'name of data', data: data }
/ws/:key        Gets specic data where ':key' is the data type.
```

##### Known Data from System
 * config
 * dealer
 * energy
 * energy_star
 * equipment_events
 * history
 * idu_config
 * idu_faults
 * idu_status
 * notifications
 * odu_config
 * odu_faults
 * odu_status
 * profile
 * root_cause
 * status
 * system
 * utility_events
 * weather


#### Future Features
 * Web mobile friendly interface
 * Node-RED and Home-Assistant integration


#### Credits
I would like to thank nebulous who developed https://github.com/nebulous/infinitude for which this project is based on.