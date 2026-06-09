const cache = {};
const CACHE_TTL = 5 * 60 * 1000;

function cacheMiddleware(duration = CACHE_TTL) {
  return (req, res, next) => {
    const userId = req.employee ? req.employee._id.toString() : 'anonymous';
    const key = `${userId}:${req.originalUrl || req.url}`;

    const cached = cache[key];
    if (cached && Date.now() - cached.timestamp < duration) {
      return res.json(JSON.parse(JSON.stringify(cached.data)));
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      cache[key] = {
        data: JSON.parse(JSON.stringify(body)),
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

setInterval(() => {
  const now = Date.now();
  for (const key in cache) {
    if (now - cache[key].timestamp > CACHE_TTL * 2) {
      delete cache[key];
    }
  }
}, 60000);

module.exports = { cacheMiddleware, clearCache };
