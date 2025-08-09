const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const config = {
  BASE_URLS: {
    PATENTS: "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=VN",
    DESIGNS: "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/designs?id=VN",
    TRADEMARKS: "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=VN",
  },
  path: {
    data: "ID.csv",
    output: "output.txt",
    log: "log.txt",
    error: "error_log.txt",
  },
  THREAD_COUNT: 5,
  TOTAL_REQUEST: 30000,
  RETRY_LIMIT: 10,
  delay: {
    BETWEEN_REQUEST: 1500,
  },
  string: {
    INTERNAL_SERVER_ERROR: "An unexpected server error has occurred",
  },
};

const IDs = fs.readFileSync(config.path.data, "utf-8").split("\n").filter(Boolean);

function getTypeById(id) {
  const prefix = id.split("-")[0];
  switch (prefix) {
    case "1":
    case "2": return "PATENTS";
    case "3": return "DESIGNS";
    case "4": return "TRADEMARKS";
    default: return "TRADEMARKS";
  }
}

function getUrlById(id) {
  const type = getTypeById(id);
  return config.BASE_URLS[type] + id.replace(/-/g, "");
}

async function start() {
  const promises = [];
  for (let index = 0; index < config.THREAD_COUNT; index++) {
    promises.push(recurse_request(index));
  }
  await Promise.all(promises);
}

async function recurse_request(i, retryCount = 0) {
  await delay(config.delay.BETWEEN_REQUEST);
  if (i >= config.TOTAL_REQUEST || i >= IDs.length) return;

  const id = IDs[i];
  const url = getUrlById(id);
  const type = getTypeById(id);

  try {
    const res = await fetch(url);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    if (html.includes(config.string.INTERNAL_SERVER_ERROR) || html.includes("${appltype}")) {
      throw new Error("Internal HTML Error");
    }

    const doc = new JSDOM(html).window.document;
    const data = extractCommonData(doc, type);
    fs.appendFileSync(config.path.output, `${id}\t${data}\n`);
  } catch (err) {
    if (retryCount < config.RETRY_LIMIT) {
      console.warn(`Retrying ${id}, attempt ${retryCount + 1}`);
      await recurse_request(i, retryCount + 1);
    } else {
      fs.appendFileSync(config.path.error, `${id} failed: ${err.message}\n`);
    }
  }
  recurse_request(i + config.THREAD_COUNT);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCommonData(doc, type) {
  let fields = Array.from(doc.querySelectorAll(".product-form-details"))
    .map((e) => e.textContent.trim().replace(/\s+/g, " "));

  if (type === "TRADEMARKS" && fields[10]) {
    fields[10] = Array.from(doc.querySelectorAll(".row"))
      .map((row) => {
        const col2 = row.querySelector(".col-md-2");
        const col10 = row.querySelector(".col-md-10");
        return col2 && col10 ? `Class/Nhóm ${col2.textContent.trim()}: ${col10.textContent.trim()}` : null;
      })
      .filter(Boolean)
      .join("<lf>");
  }

  const img = doc.querySelector("img")?.getAttribute("src") || "no image";
  const table = doc.querySelector("#accordion-3a table tbody");
  const timeline = table
    ? Array.from(table.querySelectorAll("tr")).map((tr) => {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length >= 3) [tds[0], tds[1]] = [tds[1], tds[0]];
        return tds.map((td) => td.textContent.trim()).join("<t>");
      }).join("<lf>")
    : "no table data";

  return [img, ...fields, timeline].join("\t");
}

start();
