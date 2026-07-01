const crypto = require('crypto');

function normalizeAppUrl(req) {
  const configured = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  return String(configured).replace(/\/+$/, '');
}

function createSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = {
  normalizeAppUrl,
  createSecureToken,
  hashToken
};
