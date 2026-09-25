const { JSDOM } = require("jsdom");

const MADRID_RECORD_BASE = "https://www3.wipo.int/madrid/monitor/en/showData.jsp";
const MADRID_DATA_BASE = "https://www3.wipo.int/madrid/monitor/jsp/data.jsp";
const PCT_COUNTRY_NAME_OVERRIDES = {
  AP: "ARIPO",
  EA: "EAPO",
  EP: "EPO",
  GC: "GCC Patent Office",
  KR: "Republic of Korea",
  OA: "African Intellectual Property Organization (OAPI)",
  US: "United States of America",
  VN: "Vietnam",
  WO: "WIPO",
};
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function normalizeMadridInput(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(?:5-)?(\d{1,7})$/);
  if (!match || !/[1-9]/.test(match[1])) return null;

  const madridNumber = match[1].padStart(7, "0");
  return {
    original: raw,
    madridNumber,
    canonicalId: `5-${madridNumber}`,
    romId: `ROM.${madridNumber}`,
  };
}

function isMadridId(value) {
  return /^5-\d{7}$/.test(String(value || "").trim());
}

function cleanCell(value) {
  return String(value || "")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatCompactDate(value) {
  const text = cleanCell(value);
  const match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : text;
}

function firstText(root, selector) {
  return cleanCell(root.querySelector(selector)?.textContent || "");
}

function unique(values) {
  return [...new Set(values.map(cleanCell).filter(Boolean))];
}

function pctCountryDisplayName(value) {
  const raw = cleanCell(value);
  if (!raw) return "";
  const code = raw.toUpperCase() === "UK" ? "GB" : raw.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return raw;
  return PCT_COUNTRY_NAME_OVERRIDES[code] || regionNames.of(code) || raw;
}

function joinAddress(group) {
  if (!group) return "";
  const names = unique(Array.from(group.querySelectorAll("NAME > NAMEL"), (node) => node.textContent));
  const address = group.querySelector("ADDRESS");
  const countryName = address ? pctCountryDisplayName(firstText(address, "COUNTRY")) : "";
  const addressParts = address
    ? unique([
      ...Array.from(address.querySelectorAll("ADDRL"), (node) => node.textContent),
      countryName,
    ].map((part) => cleanCell(part).replace(/\s*,\s*$/, "")))
    : [];

  const nameText = names.join(" | ");
  const addressText = addressParts.join(", ");
  return [nameText, addressText].filter(Boolean).join(": ");
}

function parsePriorityGroups(doc) {
  const groups = Array.from(doc.querySelectorAll("PRIGR, PRIORITY"));
  return groups.map((group) => {
    const number = firstText(group, "PRIN, PRIORITYN, BASREGN");
    const date = formatCompactDate(firstText(group, "PRID, PRIORITYD, BASREGD"));
    const country = firstText(group, "PRIC, COUNTRY, CPCD");
    return [number, date, country].filter(Boolean).join(" | ");
  }).filter(Boolean).join("<lf>");
}

function parseClasses(current) {
  return Array.from(current.querySelectorAll("BASICGS > GSGR, GSGR"))
    .map((group) => {
      const classNumber = cleanCell(group.getAttribute("NICCLAI")).replace(/\D/g, "");
      const terms = firstText(group, "GSTERMEN") || firstText(group, "GSTERMFR") || firstText(group, "GSTERMES");
      if (!classNumber && !terms) return null;
      const padded = classNumber ? classNumber.padStart(2, "0") : "";
      return {
        classNumber: padded,
        goodsServices: terms,
        text: `Class/Nhóm ${padded}: ${terms}`.trim(),
      };
    })
    .filter(Boolean);
}

function parseTransactions(mark) {
  const ignored = new Set(["CURRENT", "STDMIND", "MARDUR", "BASICGS", "BASGR"]);
  return Array.from(mark.children)
    .filter((node) => !ignored.has(node.tagName))
    .map((node) => {
      const dateValue = node.getAttribute("PUBDATE") || node.getAttribute("NOTDATE") || node.getAttribute("REGEDAT") || "";
      if (!dateValue) return "";
      const details = [
        node.getAttribute("GAZNO") ? `GAZNO=${node.getAttribute("GAZNO")}` : "",
        node.getAttribute("INTOFF") ? `INTOFF=${node.getAttribute("INTOFF")}` : "",
      ].filter(Boolean).join(", ");
      return [formatCompactDate(dateValue), node.tagName, details].join("<t>");
    })
    .filter(Boolean)
    .join("<lf>");
}

function parseMadridXml(xmlText, expectedMadridNumber = "") {
  let source = String(xmlText || "");
  const start = source.search(/<\?xml\b|<MARKGR\b/i);
  if (start > 0) source = source.slice(start);

  const doc = new JSDOM(source, { contentType: "text/xml" }).window.document;
  const parserError = doc.querySelector("parsererror");
  const mark = doc.querySelector("MARKGR");
  if (parserError || !mark) {
    throw new Error(`Madrid XML could not be parsed${parserError ? `: ${cleanCell(parserError.textContent)}` : ""}`);
  }

  const intRegNumber = cleanCell(mark.getAttribute("INTREGN") || expectedMadridNumber).padStart(7, "0");
  if (expectedMadridNumber && intRegNumber !== expectedMadridNumber) {
    throw new Error(`Madrid XML returned registration ${intRegNumber}, expected ${expectedMadridNumber}`);
  }

  const current = mark.querySelector("CURRENT") || mark;
  const image = current.querySelector("IMAGE");
  const classes = parseClasses(current);
  const holder = joinAddress(current.querySelector("HOLGR"));
  const representative = joinAddress(current.querySelector("REPGR"));
  const correspondent = joinAddress(current.querySelector("CORRGR"));
  const previousHolders = Array.from(current.querySelectorAll("PHOLGR")).map(joinAddress).filter(Boolean);
  const designatedCountries = unique(Array.from(current.querySelectorAll("DESPG > DCPCD"), (node) => node.textContent));
  const registrationDate = formatCompactDate(mark.getAttribute("INTREGD"));
  const expiryDate = formatCompactDate(mark.getAttribute("EXPDATE"));
  const firstNotice = mark.querySelector(":scope > ENN") || mark.querySelector("ENN");
  const publication = firstNotice
    ? [cleanCell(firstNotice.getAttribute("GAZNO")), formatCompactDate(firstNotice.getAttribute("PUBDATE"))].filter(Boolean).join(" ")
    : "";
  const markText = cleanCell(image?.getAttribute("TEXT") || firstText(current, "MARKNAME, MARKTEXT"));
  const colour = cleanCell(image?.getAttribute("COLOUR"));
  const markType = cleanCell(image?.getAttribute("TYPE"));
  const applicationNumberDate = intRegNumber
    ? [`5-${intRegNumber}`, registrationDate].filter(Boolean).join(" ")
    : "";

  // Order matches the existing NH_WIPO TSV header after ID.
  const values = [
    "no image",
    "Nhãn hiệu quốc tế",
    "Đăng ký quốc tế Madrid",
    [intRegNumber, registrationDate].filter(Boolean).join(" "),
    "",
    expiryDate,
    applicationNumberDate,
    publication,
    markText,
    colour === "Y" ? "Colour claimed" : "",
    parsePriorityGroups(doc),
    classes.map((item) => item.text).join("<lf>"),
    "",
    holder,
    representative,
    markText,
    "",
    markType,
    "",
    parseTransactions(mark),
  ].map(cleanCell);

  return {
    intRegNumber,
    values,
    outputData: `${values.join("\t")}\n`,
    metadata: {
      international_registration_number: intRegNumber,
      international_registration_date: registrationDate,
      expiry_date: expiryDate,
      office_of_origin: cleanCell(mark.getAttribute("OOCD")),
      mark_text: markText,
      mark_type: markType,
      holder,
      representative,
      correspondent,
      previous_holders: previousHolders,
      designated_countries: designatedCountries,
      classes: classes.map(({ classNumber, goodsServices }) => ({ class_number: classNumber, goods_services: goodsServices })),
    },
  };
}

function extractQueryIdentifier(pageHtml) {
  const match = String(pageHtml || "").match(/ROM_ACT\.LOGO_WIPO_(?:FULL|SMALL)[^"']*?[?&](?:amp;)?qi=([^"'&<>]+)/i);
  if (!match) throw new Error("Madrid Monitor page did not expose its XML query token");
  return match[1].replace(/&amp;/g, "&");
}

function extractMarkImageUrl(pageHtml, pageUrl = MADRID_RECORD_BASE) {
  const doc = new JSDOM(String(pageHtml || "")).window.document;
  const image = doc.querySelector("td.mark img");
  const src = cleanCell(image?.getAttribute("src"));
  if (!src || /\/missing\.gif(?:$|[?#])/i.test(src)) return "";
  return new URL(src, pageUrl).href;
}

function imageExtension(contentType, bytes) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("gif")) return "gif";
  if (type.includes("webp")) return "webp";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  const data = Buffer.from(bytes || []);
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (data.subarray(0, 6).toString("ascii").startsWith("GIF8")) return "gif";
  return "jpg";
}

function getCookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";", 1)[0]).filter(Boolean).join("; ");
}

async function fetchMadridXml(canonicalId, options = {}) {
  const madrid = normalizeMadridInput(canonicalId);
  if (!madrid) throw new Error(`Invalid Madrid international trademark ID: ${canonicalId}`);

  const fetchImpl = options.fetchImpl || fetch;
  const headers = { ...(options.headers || {}) };
  const pageUrl = `${MADRID_RECORD_BASE}?ID=${encodeURIComponent(madrid.romId)}&DES=1`;
  const pageResponse = await fetchImpl(pageUrl, { headers, signal: options.signal });
  if (!pageResponse.ok) throw new Error(`Madrid Monitor record page returned HTTP ${pageResponse.status}`);
  const pageHtml = await pageResponse.text();
  const queryIdentifier = extractQueryIdentifier(pageHtml);
  const xmlUrl = `${MADRID_DATA_BASE}?qi=${encodeURIComponent(queryIdentifier)}&TYPE=DATA&FORMAT=ROMARIN&KEY=${encodeURIComponent(madrid.romId)}`;
  const cookie = getCookieHeader(pageResponse);
  const xmlResponse = await fetchImpl(xmlUrl, {
    headers: { ...headers, Referer: pageUrl, ...(cookie ? { Cookie: cookie } : {}) },
    signal: options.signal,
  });
  if (!xmlResponse.ok) throw new Error(`Madrid Monitor XML link returned HTTP ${xmlResponse.status}`);

  const bytes = await xmlResponse.arrayBuffer();
  const contentType = String(xmlResponse.headers.get("content-type") || "");
  const charset = contentType.match(/charset\s*=\s*([^;\s]+)/i)?.[1] || "utf-8";
  let xml;
  try {
    xml = new TextDecoder(charset).decode(bytes);
  } catch (_error) {
    xml = new TextDecoder("utf-8").decode(bytes);
  }
  if (!/<MARKGR\b/i.test(xml)) throw new Error("Madrid Monitor XML link did not return a MARKGR record");

  const imageUrl = extractMarkImageUrl(pageHtml, pageUrl);
  let imageBuffer = null;
  let imageContentType = "";
  let imageFileExtension = "";
  let imageError = "";
  if (imageUrl) {
    try {
      const imageResponse = await fetchImpl(imageUrl, {
        headers: { ...headers, Accept: "image/*", Referer: pageUrl, ...(cookie ? { Cookie: cookie } : {}) },
        signal: options.signal,
      });
      if (imageResponse.ok) {
        imageContentType = String(imageResponse.headers.get("content-type") || "");
        if (/^image\//i.test(imageContentType)) {
          imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
          imageFileExtension = imageExtension(imageContentType, imageBuffer);
        } else {
          imageError = `Madrid mark image returned ${imageContentType || "a non-image response"}`;
        }
      } else {
        imageError = `Madrid mark image returned HTTP ${imageResponse.status}`;
      }
    } catch (error) {
      imageError = error?.message || String(error);
    }
  }

  return {
    ...madrid,
    pageUrl,
    xmlUrl,
    xml,
    xmlResponse,
    imageUrl,
    imageBuffer,
    imageContentType,
    imageFileExtension,
    imageError,
  };
}

module.exports = {
  MADRID_RECORD_BASE,
  normalizeMadridInput,
  isMadridId,
  parseMadridXml,
  extractQueryIdentifier,
  extractMarkImageUrl,
  pctCountryDisplayName,
  fetchMadridXml,
};
