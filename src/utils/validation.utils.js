function normalizeProfileImage(value) {
  if (value === null || value === '') return null;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    const error = new Error('Profile image must be an image data URL');
    error.statusCode = 400;
    throw error;
  }
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) {
    const error = new Error('Profile image must be PNG, JPG, WEBP, or GIF');
    error.statusCode = 400;
    throw error;
  }
  if (Buffer.byteLength(value, 'utf8') > 750 * 1024) {
    const error = new Error('Profile image must be smaller than 750 KB');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

module.exports = {
  normalizeProfileImage
};
