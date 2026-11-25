const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectWipoResponse } = require("./wipo_response_validation");

test("recognizes populated WIPO detail HTML using DOM selectors", () => {
  const html = `<div id="accordion-1a"><div class="product-form-label">(200) Application</div><div class="product-form-details"><div class="row"><div class="col-md-6">1-2024-06263</div></div></div></div>`;
  assert.equal(inspectWipoResponse(html).usable, true);
});

test("classifies a successful but empty WIPO detail shell as empty", () => {
  const html = `<html><body><div id="accordion-1a"><div class="product-form-label">(200) Application</div><div class="product-form-details"> </div></div></body></html>`;
  assert.deepEqual(inspectWipoResponse(html).classification, "empty");
});

test("keeps HTTP 200 CAPTCHA and server-error pages on the normal retry path", () => {
  assert.equal(inspectWipoResponse(`<html><body><div class="g-recaptcha">challenge</div>${" ".repeat(100)}</body></html>`).classification, "retryable");
  assert.equal(inspectWipoResponse(`<html><body><h1>Internal Server Error</h1>${" ".repeat(100)}</body></html>`).classification, "retryable");
  assert.equal(inspectWipoResponse("Access Denied").classification, "retryable");
});

test("prefers populated record fields over CAPTCHA code included by the page shell", () => {
  const html = `<html><script src="/captcha/client.js"></script><body><div id="accordion-1a"><div class="product-form-label">Application</div><div class="product-form-details">1-2024-06263</div></div></body></html>`;
  assert.equal(inspectWipoResponse(html).classification, "record");
});
