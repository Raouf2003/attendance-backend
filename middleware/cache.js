const cache = {};
const CACHE_TTL = 5 * 60 * 1000;

function cacheMiddleware(duration = CACHE_TTL) {
  return (req, res, next) => {
    const key = req.originalUrl || req.url;

    const cached = cache[key];
    if (cached && Date.now() - cached.timestamp < duration) {
      return res.json(cached.data);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      cache[key] = {
        data: body,
        timestamp: Date.now(),
      };
      originalJson(body);
    };

    next();
  };
}

function clearCache() {
  for (const key in cache) {
    delete cache[key];
  }
}

module.exports = { cacheMiddleware, clearCache };
