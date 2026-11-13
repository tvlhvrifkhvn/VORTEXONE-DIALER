const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../middleware/errorHandler');

// MMS media (F-40). Only real JPEG, PNG and GIF images are accepted,
// recognised by their content (start and end markers), not by the file name or the type the
// browser declared. Saved under a random name with the extension of the
// checked type; the original name and extension are never kept.
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
// Start and end markers of each format: a file that merely begins with an
// image signature (text after a "GIF89a" header, say) is refused too.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_TYPES = [
  {
    ext: 'png', mime: 'image/png',
    test: (b) => b.length >= 45 && b.subarray(0, 8).equals(PNG_SIG) && b.subarray(12, 16).toString('latin1') === 'IHDR'
      && b.subarray(b.length - 8, b.length - 4).toString('latin1') === 'IEND',
  },
  {
    ext: 'jpg', mime: 'image/jpeg',
    test: (b) => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
  },
  {
    ext: 'gif', mime: 'image/gif',
    test: (b) => b.length >= 14 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) && b[b.length - 1] === 0x3b,
  },
];
// What /uploads serves: names this service creates (and image names from before it).
const SERVED_NAME = /^[A-Za-z0-9-]+\.(png|jpe?g|gif)$/;
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

function imageType(buffer) {
  return IMAGE_TYPES.find((t) => t.test(buffer)) || null;
}

/** Saves an uploaded image; 400 for anything that isn't a real JPEG / PNG / GIF. */
async function saveImage(file) {
  if (!file || !file.buffer || file.buffer.length === 0) throw new ApiError(400, 'No file uploaded');
  const type = imageType(file.buffer);
  if (!type) throw new ApiError(400, 'Only JPEG, PNG and GIF images can be attached');
  const name = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(UPLOADS_DIR, name), file.buffer, { flag: 'wx' });
  return { url: `/uploads/${name}`, contentType: type.mime };
}

/** A mediaUrl may only be one of our own uploaded images that exists. */
function assertOwnMediaUrl(mediaUrl) {
  const m = /^\/uploads\/([^/]+)$/.exec(String(mediaUrl));
  if (!m || !SERVED_NAME.test(m[1]) || !fs.existsSync(path.join(UPLOADS_DIR, m[1]))) {
    throw new ApiError(400, 'The attachment must be an image uploaded here (use Attach image)');
  }
}

/** Express middleware for /uploads: only image names, served as images that never run. */
function serveUploads(staticHandler) {
  return (req, res, next) => {
    const name = decodeURIComponent(req.path.replace(/^\//, ''));
    const m = SERVED_NAME.exec(name);
    if (!m) return res.status(404).end();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', MIME_BY_EXT[m[1].toLowerCase()]);
    return staticHandler(req, res, next);
  };
}

module.exports = { UPLOADS_DIR, saveImage, assertOwnMediaUrl, serveUploads, imageType };
