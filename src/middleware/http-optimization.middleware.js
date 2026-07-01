const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createVersionedHtmlSender({ publicDir, buildHash }) {
  function versionHtmlAssets(html) {
    const versioned = String(html || '').replace(
      /((?:href|src)=["'][^"']+\.(?:js|css))(?:\?v=[^"']*)?(["'])/gi,
      `$1?v=${buildHash}$2`
    );
    if (versioned.includes('window.SAASRAY_BUILD_HASH')) return versioned;
    return versioned.replace('</head>', `<script>window.SAASRAY_BUILD_HASH="${buildHash}"</script></head>`);
  }

  return function sendVersionedHtml(res, fileName) {
    const filePath = path.join(publicDir, fileName);
    const stat = fs.statSync(filePath);
    const etag = `"${buildHash}-${stat.size}"`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    if (res.req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.send(versionHtmlAssets(fs.readFileSync(filePath, 'utf8')));
  };
}

function createVersionedHtmlMiddleware(sendVersionedHtml) {
  return function versionedHtmlMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const pathname = req.path || '';
    if (pathname === '/' || pathname === '/index.html') return sendVersionedHtml(res, 'index.html');
    if (pathname === '/reports.html') return sendVersionedHtml(res, 'reports.html');
    if (pathname === '/dashboards.html') return sendVersionedHtml(res, 'dashboards.html');
    if (pathname === '/admin' || pathname === '/admin.html' || pathname.startsWith('/admin/')) {
      return sendVersionedHtml(res, 'admin.html');
    }
    return next();
  };
}

function noStoreApiCacheMiddleware(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

function shouldCompressResponse(req, res) {
  if (req.method === 'HEAD') return false;
  const type = String(res.getHeader('Content-Type') || '');
  return /json|text|javascript|css|svg|xml|html/i.test(type);
}

function httpOptimizationMiddleware(req, res, next) {
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Keep-Alive', 'timeout=5, max=1000');
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const chunks = [];
  let passthrough = false;

  function shouldBufferForCompression() {
    if (passthrough) return false;
    const alreadyEncoded = res.getHeader('Content-Encoding');
    const clientSupportsCompression = /\bbr\b/.test(acceptEncoding) || /\bgzip\b/.test(acceptEncoding);
    if (!clientSupportsCompression || alreadyEncoded || !shouldCompressResponse(req, res)) {
      passthrough = true;
      return false;
    }
    return true;
  }

  res.write = function writeCompressed(chunk, encoding, callback) {
    if (!shouldBufferForCompression()) {
      return originalWrite(chunk, encoding, callback);
    }
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    if (typeof callback === 'function') process.nextTick(callback);
    return true;
  };

  res.end = function endCompressed(chunk, encoding, callback) {
    if (!shouldBufferForCompression()) {
      return originalEnd(chunk, encoding, callback);
    }
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    const body = Buffer.concat(chunks);
    const alreadyEncoded = res.getHeader('Content-Encoding');
    if (body.length < 1024 || alreadyEncoded || !shouldCompressResponse(req, res)) {
      if (chunks.length) originalWrite(body);
      return originalEnd(undefined, undefined, callback);
    }

    const done = (err, compressed, encodingName) => {
      if (err || !compressed || compressed.length >= body.length) {
        res.removeHeader('Content-Encoding');
        res.setHeader('X-SaaSRAY-Compression', 'identity');
        originalWrite(body);
      } else {
        res.setHeader('Content-Encoding', encodingName);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', compressed.length);
        res.setHeader('X-SaaSRAY-Compression', `${encodingName}; original=${body.length}; compressed=${compressed.length}`);
        originalWrite(compressed);
      }
      originalEnd(undefined, undefined, callback);
    };

    res.removeHeader('Content-Length');
    if (/\bbr\b/.test(acceptEncoding)) {
      zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, (err, compressed) => done(err, compressed, 'br'));
    } else if (/\bgzip\b/.test(acceptEncoding)) {
      zlib.gzip(body, { level: 6 }, (err, compressed) => done(err, compressed, 'gzip'));
    } else {
      originalWrite(body);
      originalEnd(undefined, undefined, callback);
    }
  };
  next();
}

function staticAssetHeaders(res, filePath) {
  if (/\.(html)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

module.exports = {
  createVersionedHtmlSender,
  createVersionedHtmlMiddleware,
  noStoreApiCacheMiddleware,
  httpOptimizationMiddleware,
  staticAssetHeaders
};
