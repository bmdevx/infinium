# Infinium


### Infinium is a passive monitor and controller for Carrier Infinity Touch thermostats written using NodeJS


##### Features
  * Monitor all data in and out of an infinity system
  * Set and control the infinity touch control thermostat
  * Wunderground Support (Beta)
 

#### Control / View Using
  * REST API
  * WebSockets
  * Class Functions

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


### REST
All data is in JSON Format
```
GET   /api/status                   Retreives System Status
GET   /api/activity/:zone/:activity Retreives Activity Information
GET   /api/schedule/:zone           Retreives Schedule for the entire Week
GET   /api/schedule/:zone/:day      Retreives Schedule for a specific Day
GET   /api/zone/:zone               Retreives Zone Information

POST  /api/activity/:zone/:activity Updates Activity
      *POST Data Options*
          clsp: (int) Cooling Set Point, value between min and max
          htsp: (int) Heat Set Point, value between min and max temp
          fan:  (string) Fan Level
                  'off' (AKA auto mode) Fan is off unless heating/cooling
                  'low'  Low Fan Speed
                  'med'  Medium Fan Speed
                  'high' High Fan Speed

POST  /api/hold/:zone               Puts a hold on a Zone
      *POST Data Options*
          activity:  (string) Activity for which the system will hold
                       'home' (default), 'away', 'sleep', 'wake', 'manual'
          holdUntil: (string) Time in HH:MM format for which the system will hold the current activity
                       ex: '18:30' (6:30PM)
                       
POST  /api/schedule/:zone
      Required JSON Array for 'schedule' value:
      [
        {
          id: 'Monday', //day of week
          periods: [
            {
              id: 1,            // period in schedule of day (1-5)
              activity: 'home', // 'home', 'away', 'sleep', 'wake', 'manual'
              time: '18:30',    // time you want the activity to be ready by
              enabled: 'on'     // if you want the period to be enabled ('on' or 'off')
            },
            ...
          ]
        },
        ...
      ]
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
 * Security Policy (Keys for controlling the thermostat or viewing non-status data from REST/WS)


#### Credits
I would like to thank nebulous who developed https://github.com/nebulous/infinitude for which this project is based on.