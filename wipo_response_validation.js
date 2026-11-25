const { JSDOM } = require("jsdom");

const RETRYABLE_PAGE_PATTERNS = [
  /HTTP ERROR (?:429|500|502|503|504)/i,
  /Gateway Timeout/i,
  /Service Temporarily Unavailable/i,
  /Internal Server Error/i,
  /Connection refused|ECONNREFUSED/i,
  /(?:g-recaptcha|captcha-container|\/captcha\b)/i,
  /Access Denied|Too Many Requests/i,
];

function inspectWipoResponse(text) {
  const html = typeof text === "string" ? text : "";

  let document;
  try { document = new JSDOM(html).window.document; }
  catch (_error) { return { usable: false, classification: "retryable", reason: "Response HTML could not be parsed" }; }

  const detailNodes = [...document.querySelectorAll(".product-form-details")];
  const populatedDetails = detailNodes.filter((node) => node.textContent.trim() || node.querySelector("img[src], table tr, input[value]"));
  const labelCount = document.querySelectorAll(".product-form-label").length;
  const accordionCount = document.querySelectorAll("#accordion-1a, #accordion-2a, #accordion-3a").length;
  const usable = populatedDetails.length > 0 && (labelCount > 0 || accordionCount > 0);
  if (usable) {
    return { usable: true, classification: "record", detailCount: populatedDetails.length, labelCount, accordionCount };
  }
  if (RETRYABLE_PAGE_PATTERNS.some((pattern) => pattern.test(html))) {
    return { usable: false, classification: "retryable", reason: "WIPO returned an error, throttle, or CAPTCHA page" };
  }
  if (html.trim().length < 100) {
    return { usable: false, classification: "empty", reason: "HTTP 200 response was empty or too short" };
  }
  return {
    usable: false,
    classification: "empty",
    reason: "HTTP 200 contained no populated WIPO record fields",
    detailCount: populatedDetails.length,
    labelCount,
    accordionCount,
  };
}

module.exports = { inspectWipoResponse };
