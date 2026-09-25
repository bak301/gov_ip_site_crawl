'use strict';

const puppeteer = require('puppeteer');

let browserPromise;
let active = 0;
const waiting = [];

async function acquire() {
  if (active >= 2) await new Promise((resolve) => waiting.push(resolve));
  active += 1;
}

function release() {
  active -= 1;
  waiting.shift()?.();
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ['--disable-gpu'] })
      .then((browser) => {
        browser.on('disconnected', () => { browserPromise = null; });
        return browser;
      }).catch((error) => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

async function renderReportPdf(html) {
  if (typeof html !== 'string' || !html.includes('printing-report') || Buffer.byteLength(html, 'utf8') > 8_000_000) {
    throw new Error('Invalid or oversized WipoPublish report.');
  }
  await acquire();
  let page;
  try {
    page = await (await getBrowser()).newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (/^(data:|about:)/i.test(url) || (request.resourceType() === 'image' && /^https:\/\/wipopublish\.ipvietnam\.gov\.vn\//i.test(url))) request.continue();
      else request.abort();
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 }).catch(() => {});
    await page.emulateMediaType('print');
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' } }));
  } finally {
    await page?.close().catch(() => {});
    release();
  }
}

async function closeReportPdfBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

module.exports = { renderReportPdf, closeReportPdfBrowser };
