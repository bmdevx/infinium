module.exports = function (req) {
    return {
        url: `${req.protocol || 'http'}://${req.host || req.hostname}${req.baseUrl || req.path}`,
        headers: req.headers,
        method: req.method
    }
}