module.exports = function (req) {
    return {
        url: `${req.protocol || 'http'}://${req.hostname || req.host}${req.baseUrl || req.path}`,
        headers: req.headers,
        method: req.method
    }
}