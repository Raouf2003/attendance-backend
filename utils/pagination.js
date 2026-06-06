function paginate(query, page = 1, limit = 20) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  return query.skip(skip).limit(limitNum);
}

function paginatedResponse(data, total, page = 1, limit = 20) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

  return {
    data,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
  };
}

module.exports = { paginate, paginatedResponse };
