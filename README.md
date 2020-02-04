# Infinium

![GitHub Workflow Status](https://img.shields.io/github/workflow/status/bmdevx/infinium/npm-publish?style=flat-square) ![David](https://img.shields.io/david/bmdevx/infinium?style=flat-square)  ![npm](https://img.shields.io/npm/dt/infinium?style=flat-square) ![npm](https://img.shields.io/npm/v/ninfinium?style=flat-square) ![GitHub](https://img.shields.io/github/license/bmdevx/infinium?style=flat-square)

## Infinium is a passive monitor and controller for Carrier Infinity Touch thermostats written using NodeJS

### Features

* Monitor all data in and out of an infinity system
* Set and control the infinity touch control thermostat
* Wunderground Support (Beta)

### Control / View Using

* REST API
* WebSockets
* Class Functions

### Config Example

```js
{
    port: 3000,                  // Server Port
    wsEnabled: true,             // WebSockets Enabled
    apiEnabled: true,            // REST API Enabled
    forwardInterval: 900000,     // How often to forward data request to Carrier (in millis)
    weatherRefreshRate: 300000,  // How often for weather module to update
    keepHistory: false,          // Keep Timestamped config and data files
    keepHistoryOnChange: true,   // Only create new history file if the data has changed
    historyExclusions: 'system', // List of files not kept in the history folder. (comma delimited)
    debugMode: false,            // Enable Debugging in the logs

    // Optional. If not in config Infinium defaults to getting weather data from Carrier.
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

```bash
INFINIUM_PORT = 3000
INFINIUM_WS_ENABLED = true
INFINIUM_API_ENABLED = true
INFINIUM_KEEP_HISTORY = false
INFINIUM_HISTORY_EXCLUSIONS = 'config,status,system'
INFINIUM_KEEP_HISTORY_ON_CHANGE = true
INFINIUM_FORWARD_INTERVAL = 90000
INFINIUM_WEATHER_REFRESH_RATE = 90000
INFINIUM_DEBUG_MODE = false
INFINIUM_DATA = /data/
INFINIUM_HISTORY_DATA = /data/history/
INFINIUM_TZ = 0  #Sets the timezone if the system does not have it set
```

### REST

#### Notes

##### - For all requests, the default zone is 1

##### - POST data is urlencoded

```text
GET   /api/status              Retreives System Status

GET   /api/config              Retreives System Config

GET   /api/activity/:activity  Retreives Activity Information
      *Optional Parameters*
          zone: 1-8

GET   /api/schedule/           Retreives System Schedule (Week or Specific Day)
      *Optional Parameters*
          zone: 1-8
          day:  monday, tuesday, ..

GET   /api/zone/:zone          Retreives Zone Information (1-8)


POST  /api/activity/:activity  Updates an Activity
      *POST Data Options*
          zone: (int) 1-8
          clsp: (int) Cooling Set Point, value between min and max
          htsp: (int) Heat Set Point, value between min and max temp
          fan:  (string) Fan Level
                  'off' (AKA auto mode) Fan is off unless heating/cooling
                  'low'  Low Fan Speed
                  'med'  Medium Fan Speed
                  'high' High Fan Speed

POST  /api/hold                Puts a hold on a Zone
      *POST Data Options*
          zone:      (int) 1-8
          activity:  (string) Activity for which the system will hold
                       'home' (default), 'away', 'sleep', 'wake', 'manual'
          holdUntil: (string) Time in HH:MM format for which the system will hold the current activity
                       ex: '18:30' (6:30PM)

POST  /api/schedule/:zone      Updates the schedule of a zone
      *Required* JSON Array for 'schedule' value:
          schedule: [
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
          ],
       *POST Data Options*
          zone: (int) 1-8
```

### WebSocket

```text
/ws/status      Gets Status
/ws/config      Gets Config
/ws/update      Gets all data in the format of { id: 'name of data', data: data }
/ws/:key        Gets specic data where ':key' is the data type.
```

#### Data Events from Infinium

##### *Some events may not be available depending on your system*

* config
* dealer
* energy
* energy_star
* equipment_events
* history
* idu_config
* idu_faults
* idu_status
* manifest
* notifications
* odu_config
* odu_faults
* odu_status
* profile
* release_notes
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

I would like to thank nebulous who developed <https://github.com/nebulous/infinitude> for which this project is based on.
