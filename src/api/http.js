// Общи помощни функции за HTTP (API за сайта и админ).

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MAX_BODY = 32 * 1024;

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

// Чете JSON тяло. Само Content-Type: application/json – така форма от чужд сайт не може да прати заявка (CSRF).
function readJson(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) {
      reject(new HttpError(415, 'Очаква се JSON (Content-Type: application/json)'));
      req.resume();
      return;
    }
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > maxBytes) {
        over = true;
        reject(new HttpError(413, 'Заявката е твърде голяма'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Невалиден JSON'));
      }
    });
    req.on('error', reject);
  });
}

// IP на клиента. Зад Caddy (връзката е от 127.0.0.1) истинското IP е последното в X-Forwarded-For –
// Caddy го добавя сам, а по-предните стойности може да са подправени от клиента.
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const xff = req.headers['x-forwarded-for'];
  if (local && xff) return String(xff).split(',').pop().trim();
  return remote;
}

// Заявката е дошла по https (пряко или през Caddy)
const isHttps = (req) => Boolean(req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https';

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = { HttpError, MAX_BODY, sendJson, readJson, clientIp, isHttps, parseCookies };
