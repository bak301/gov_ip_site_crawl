const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// === CONFIG ===
const config = {
  BASE_URLS: {
    PATENTS:
      "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=VN",
    DESIGNS:
      "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/designs?id=VN",
    TRADEMARKS:
      "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=VN",
  },
  DATA_TYPE: "TRADEMARK", // default fallback for extract logic
  path: {
    data: "ID.csv",
    log: "log.txt",
    failedIDs: "failed_ids.txt",
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

// === Load IDs ===
let IDs = fs
  .readFileSync(config.path.data, "utf-8")
  .split("\n")
  .filter(Boolean);

// === Set up timestamped output folder
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseOutputDir = path.join(__dirname, "Results", timestamp);
fs.mkdirSync(baseOutputDir, { recursive: true });

// === Copy original ID list
fs.copyFileSync(config.path.data, path.join(baseOutputDir, "original_ID.csv"));

// === Create fail_id.txt
const failIdPath = path.join(baseOutputDir, "fail_id.txt");
fs.writeFileSync(failIdPath, "");

// === Create subfolders
const outputFolders = {
  PATENTS: path.join(baseOutputDir, "Patents"),
  TRADEMARKS: path.join(baseOutputDir, "Trademarks"),
  DESIGNS: path.join(baseOutputDir, "Designs"),
};
Object.values(outputFolders).forEach((folder) => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
});

// === Output file per type
function getOutputFile(type) {
  return path.join(outputFolders[type], `output-${timestamp}.txt`);
}
const outputFiles = {
  PATENTS: getOutputFile("PATENTS"),
  TRADEMARKS: getOutputFile("TRADEMARKS"),
  DESIGNS: getOutputFile("DESIGNS"),
};

function getTypeById(id) {
  const prefix = id.split("-")[0];
  switch (prefix) {
    case "1":
    case "2":
      return "PATENTS";
    case "3":
      return "DESIGNS";
    case "4":
      return "TRADEMARKS";
    default:
      return "TRADEMARKS";
  }
}

function getUrlById(id) {
  const type = getTypeById(id);
  return config.BASE_URLS[type] + id.replace(/-/g, "");
}

// === Output filename (legacy logic remains for structure)
function generateOutputFileName() {
  return `output-${timestamp}.txt`;
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
  if (i >= config.TOTAL_REQUEST || i >= IDs.length) {
    console.log("request completed");
    return;
  }

  const currentID = IDs[i].trim();
  const url = getUrlById(currentID);
  const startTime = performance.now();

  try {
    const response = await fetch(url);
    logJobDetails(i, response, IDs, startTime);

    if (response.status !== 200) {
      await handleServerError(i, retryCount, currentID);
    } else {
      const text = await response.text();
      if (isTextError(text)) {
        await handleServerError(i, retryCount, currentID);
      } else {
        extractDataThenContinue(i, text);
      }
    }
  } catch (error) {
    console.error("Error while fetch:", error);
    await handleServerError(i, retryCount, currentID);
  }
}

function isTextError(text) {
  return (
    text.includes(config.string.INTERNAL_SERVER_ERROR) ||
    text.includes("${appltype}")
  );
}

async function handleServerError(i, retryCount, id) {
  if (retryCount < config.RETRY_LIMIT) {
    console.log(`Retrying job number ${i}... Attempt ${retryCount + 1}`);
    await recurse_request(i, retryCount + 1);
  } else {
    console.log(
      `Job number ${i} has failed after ${config.RETRY_LIMIT} attempts. Moving on...\n`
    );

    const failedID = `${id}\n`;
    fs.appendFileSync(config.path.failedIDs, failedID);
    fs.appendFileSync(failIdPath, failedID);

    const type = getTypeById(id);
    const noDataEntry = `${id}\tNo data\n`;
    fs.appendFileSync(outputFiles[type], noDataEntry);

    await recurse_request(i + config.THREAD_COUNT);
  }
}

function extractDataThenContinue(i, text) {
  const currentID = IDs[i].trim();
  const outputData = extractFromHTML(text, currentID);

  const type = getTypeById(currentID);
  const formattedData = `${currentID}\t${outputData}`;
  fs.appendFileSync(outputFiles[type], formattedData);

  // preserve ID file update logic
  IDs = IDs.filter((id) => id !== currentID);
  fs.writeFileSync(config.path.data, IDs.join("\n"), "utf-8");

  recurse_request(i + config.THREAD_COUNT);
}

function logJobDetails(i, response, IDs, startTime) {
  const endTime = performance.now();
  const currentTime = new Date(Date.now()).toLocaleString("vi-VN");
  const logContent = `\nJob number ${i} has been finished at ${currentTime}\nHTTP Status : ${
    response.status
  } : ${response.statusText}\nID : ${IDs[i]}\nFinish time : ${(
    (endTime - startTime) /
    1000
  ).toFixed(2)}s`;
  console.log(logContent);
  fs.appendFileSync(config.path.log, logContent + "\n-----");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanHtml(text) {
  const accordions = new JSDOM(text).window.document.querySelectorAll(
    "#accordion-1a, #accordion-2a, #accordion-3a"
  );
  let cleanedHtml = "";
  accordions.forEach((accordion) => {
    const id = accordion.id;
    const i = parseInt(id.substring(id.lastIndexOf("-") + 1, id.length - 1));
    cleanedHtml += `<div class='accordion-${i}a'>${accordion.innerHTML}</div>`;
  });
  cleanedHtml += "\n---------------\n";
  return cleanedHtml;
}

function extractFromHTML(text, id) {
  const doc = new JSDOM(text).window.document;
  const type = getTypeById(id);

  if (type === "DESIGNS") {
    return extractDesignData(doc);
  } else if (type === "PATENTS") {
    return extractPatentData(doc);
  } else {
    return extractTrademarkData(doc);
  }
}
function extractDesignData(doc) {
  const labelsToExtract = [
    "Loại đơn",
    "(10) Số bằng và ngày cấp",
    "Trạng thái",
    "(180) Ngày hết hạn",
    "(20) Số đơn và Ngày nộp đơn",
    "(40) Số công bố và ngày công bố",
    "(30) Chi tiết về dữ liệu ưu tiên",
    "(51/52) Phân loại Locarno",
    "(71/73) Chủ đơn/Chủ bằng",
    "(72) Tác giả kiểu dáng",
    "(74) Đại diện SHCN",
    "(54) Tên kiểu dáng",
  ];

  const rows = Array.from(doc.querySelectorAll(".row"));
  const details = [];

  for (const label of labelsToExtract) {
    const row = rows.find((r) => {
      const labelDiv = r.querySelector(".product-form-label");
      const labelText = labelDiv?.textContent.trim().replace(/\s+/g, " ");
      return labelText === label;
    });

    if (row) {
      const valueDiv = row.querySelector(".product-form-details");
      let text = valueDiv
        ? valueDiv.textContent.trim().replace(/\s+/g, " ")
        : "no data";
      details.push(text);
    } else {
      details.push("no data");
    }
  }

  const imgTag = doc.querySelector("img");
  const imgURL = imgTag?.getAttribute("src") || "no image";
  details.unshift(imgURL);

  const table = doc.querySelector("#accordion-3a table tbody");
  const tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          const columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            [columns[0], columns[1]] = [columns[1], columns[0]];
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  return details.join("\t") + "\t" + tableData + "\n";
}

function extractTrademarkData(doc) {
  const accordion1aData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    if (index === 6) {
      return row.textContent;
    } else if (index === 10) {
      const combinedText = Array.from(row.querySelectorAll(".row"))
        .map((childRow) => {
          const col2 = childRow.querySelector(".col-md-2");
          const col10 = childRow.querySelector(".col-md-10");
          const col2Text = col2 ? col2.textContent.trim() : "no data";
          const col10Text = col10 ? col10.textContent.trim() : "no data";
          return `Class/Nhóm ${col2Text}: ${col10Text}<lf>`;
        })
        .join("<lf>");
      return combinedText;
    } else {
      return row.textContent;
    }
  });

  const imgURL =
    doc.querySelector(".product-form-detail img")?.getAttribute("src") ||
    "no data !";
  accordion1aData.unshift(imgURL);

  const table = doc.querySelector("#accordion-3a table tbody");
  const tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          const columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            [columns[0], columns[1]] = [columns[1], columns[0]];
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  return accordion1aData.join("\t") + "\t" + tableData + "\n";
}
function extractPatentData(doc) {
  const details = Array.from(doc.querySelectorAll(".product-form-details")).map(
    (el) => el.textContent.trim()
  );

  const imgTag = doc.querySelector("img");
  const imgURL = imgTag?.getAttribute("src") || "no data !";
  details.unshift(imgURL);

  const table = doc.querySelector("#accordion-3a table tbody");
  const tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          const columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            [columns[0], columns[1]] = [columns[1], columns[0]];
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  return details.join("\t") + "\t" + tableData + "\n";
}

start();
