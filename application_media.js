'use strict';

const http = require('http');
const { normalizeApplicationNo } = require('./tracker_core');

const TRADEMARK_API_ORIGIN = String(process.env.TRADEMARK_API_ORIGIN || 'http://127.0.0.1:47831').replace(/\/$/, '');

function request(pathname, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${TRADEMARK_API_ORIGIN}${pathname}`, { headers: { Accept: '*/*' } }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) response.destroy(new Error('Application image response is too large.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({
        ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
        statusCode: Number(response.statusCode) || 500,
        contentType: String(response.headers['content-type'] || ''),
        buffer: Buffer.concat(chunks),
      }));
    });
    request.setTimeout(120000, () => request.destroy(new Error('Application image request timed out.')));
    request.on('error', reject);
  });
}

async function listApplicationMedia(applicationNumber) {
  const applicationNo = normalizeApplicationNo(applicationNumber);
  if (!/^[1-3]-\d{4}-\d{4,}$/.test(applicationNo)) return { ok: true, applicationNo, images: [] };
  const response = await request(`/api/applications/${encodeURIComponent(applicationNo)}`, 4 * 1024 * 1024);
  if (!response.ok) throw new Error(`Image gallery lookup failed (HTTP ${response.statusCode}).`);
  const payload = JSON.parse(response.buffer.toString('utf8'));
  const images = Array.isArray(payload?.details?.sampleImages) ? payload.details.sampleImages.filter(Boolean) : [];
  return { ok: true, applicationNo, images: images.map((_url, index) => ({ index: index + 1 })) };
}

async function readApplicationMedia(applicationNumber, index) {
  const applicationNo = normalizeApplicationNo(applicationNumber);
  const imageIndex = Number(index);
  if (!/^[1-3]-\d{4}-\d{4,}$/.test(applicationNo) || !Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > 100) {
    return { ok: false, statusCode: 400, contentType: 'application/json', buffer: Buffer.from('Invalid image request.') };
  }
  return request(`/api/images/${encodeURIComponent(applicationNo)}/${imageIndex}`);
}

function desktopApplicationMedia(applicationNumber) {
  return listApplicationMedia(applicationNumber).then((result) => ({
    ...result,
    images: result.images.map((image) => ({ ...image, url: `${TRADEMARK_API_ORIGIN}/api/images/${encodeURIComponent(result.applicationNo)}/${image.index}` })),
  }));
}

module.exports = { TRADEMARK_API_ORIGIN, listApplicationMedia, readApplicationMedia, desktopApplicationMedia };
