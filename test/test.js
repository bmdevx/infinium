//const InfinityServer = require('../nodes/infinity-server.js');
const WebFileCache = require('../util/web-file-cache.js.js');


const xml2js = require('xml2js');

var xmlBuilder = new xml2js.Builder();



var xml = xmlBuilder.buildObject({
    time: {
        $: {
            "version": "1.9"
        },
        utc: new Date().toISOString()
    }
});

console.log(xml);





// const wfc = new WebFileCache();

// wfc.get('https://google.com', (err, data, fromWeb) => {
//     if (!err && data.length > 0) {

//         console.log('Loaded from: ' + fromWeb ? 'Web' : 'File');

//         setTimeout(() => {
//             wfc.get({ request: 'https://google.com', something: 'false' }, (err2, data2, fromWeb) => {
//                 console.log('Loaded from: ' + fromWeb ? 'Web' : 'File');

//                 if (!err && data2.length > 0) {
//                     console.log('works!');
//                 }
//             });
//         }, 5000);

//     }
// });