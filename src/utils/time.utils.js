function msSince(startedAt) {
  return Number((performance.now() - startedAt).toFixed(1));
}

module.exports = {
  msSince
};
