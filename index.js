const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
let failedQueue = [];
const idTimers = {}; // Tracks start time of each ID
const idDurations = {}; // Accumulates total duration of each ID
const retryTracker = {};
const idStartTimestamps = {}; // wallclock time when ID first tried
// === Set up timestamped output folder
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseOutputDir = path.join(__dirname, "Results", timestamp);
fs.mkdirSync(baseOutputDir, { recursive: true });
function extractHeadersFromDoc(doc) {
  const labelNodes = doc.querySelectorAll(".product-form-label");
  const headers = Array.from(labelNodes).map((el) => el.textContent.trim());
  const uniqueHeaders = [...new Set(headers)];
  return uniqueHeaders;
}

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
    log: path.join(baseOutputDir, "log.txt"),
    failedIDs: "failed_ids.txt",
  },
  THREAD_COUNT: 16,
  RETRY_LIMIT: 30,
  delay: {
    BETWEEN_REQUEST: 2000,
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

config.TOTAL_REQUEST = IDs.length;

// === Copy original ID list
fs.copyFileSync(config.path.data, path.join(baseOutputDir, "original_ID.csv"));

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
  if (failedQueue.length > 0) {
    console.log(
      `\n🔁 Retrying ${failedQueue.length} failed IDs after initial run...\n`
    );
    const retryIDs = [...failedQueue];
    failedQueue = [];
    IDs = retryIDs;

    const retryPromises = [];
    for (let index = 0; index < config.THREAD_COUNT; index++) {
      retryPromises.push(recurse_request(index));
    }
    await Promise.all(retryPromises);

    if (failedQueue.length > 0) {
      console.log(
        `\n❌ Final failed IDs (${failedQueue.length}) with no data:`
      );
      for (const id of failedQueue) {
        const type = getTypeById(id);
        const noDataEntry = `${id}\tNo data\n`;
        fs.appendFileSync(outputFiles[type], noDataEntry);
        fs.appendFileSync(config.path.failedIDs, `${id}\n`);
        fs.appendFileSync(failIdPath, `${id}\n`);
      }
    } else {
      console.log(`\n✅ All previously failed IDs succeeded on retry.`);
    }
  }
}
function moveOldOutputs(outputDir, keep = 5) {
  const oldDir = path.join(outputDir, "Old");
  if (!fs.existsSync(oldDir)) fs.mkdirSync(oldDir, { recursive: true });

  const entries = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "Old")
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(outputDir, a.name)).mtimeMs;
      const bTime = fs.statSync(path.join(outputDir, b.name)).mtimeMs;
      return bTime - aTime;
    });

  const toMove = entries.slice(keep);
  for (const dir of toMove) {
    const src = path.join(outputDir, dir.name);
    const dest = path.join(oldDir, dir.name);
    try {
      fs.renameSync(src, dest);
      console.log(`📦 Moved old output: ${dir.name} → /Old`);
    } catch (err) {
      console.warn(`⚠️ Failed to move ${dir.name}: ${err.message}`);
    }
  }
}

async function recurse_request(i, retryCount = 0) {
  await delay(config.delay.BETWEEN_REQUEST);
  if (i >= IDs.length) {
    console.log("request completed");
    return;
  }

  const currentID = IDs[i].trim();
  // If this is the first time we see this ID, record wallclock start
  if (!idStartTimestamps[currentID]) {
    idStartTimestamps[currentID] = Date.now();
  }

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
    const retryColor =
      retryCount < 3 ? "\x1b[32m" : retryCount < 6 ? "\x1b[33m" : "\x1b[31m";
    console.log(
      `\x1b[90mRetrying job number \x1b[0m${retryColor}${i + 1} (Attempt ${
        retryCount + 1
      })\x1b[0m`
    );

    await recurse_request(i, retryCount + 1);
  } else {
    console.log(
      `Job number ${i} has failed after ${config.RETRY_LIMIT} attempts. Moving on...\n`
    );

    if (!failedQueue.includes(id)) {
      failedQueue.push(id);
    }

    const type = getTypeById(id);

    await recurse_request(i + config.THREAD_COUNT);
  }
}

function extractDataThenContinue(i, text) {
  const currentID = IDs[i].trim();
  const outputData = extractFromHTML(text, currentID);

  const type = getTypeById(currentID);
  const formattedData = `${currentID}\t${outputData}`; // ID added here only
  fs.appendFileSync(outputFiles[type], formattedData);
  const start = idStartTimestamps[currentID];
  if (start) {
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`⏱️ Total elapsed time for ID ${currentID}: ${elapsedSec}s`);
  }

  if (!global.finishedIDs) global.finishedIDs = new Set();
  global.finishedIDs.add(currentID);

  // preserve ID file update logic
  IDs = IDs.filter((id) => id !== currentID);

  recurse_request(i + config.THREAD_COUNT);
}

function logJobDetails(i, response, IDs, startTime) {
  const endTime = performance.now();
  const currentTime = new Date(Date.now()).toLocaleString("vi-VN");

  const jobIndex = i + 1;
  const total = IDs.length;
  const ID = IDs[i].trim();

  const color = response.status === 200 ? "\x1b[32m" : "\x1b[1m\x1b[31m";
  const attemptColor = (attempt) => {
    if (attempt <= 3) return "\x1b[32m";
    if (attempt <= 6) return "\x1b[33m";
    return "\x1b[31m";
  };

  const startTimestamp = idStartTimestamps[ID];
  const elapsedSec = startTimestamp
    ? ((Date.now() - startTimestamp) / 1000).toFixed(2)
    : "N/A";

  const log =
    `\n📊 Job ${jobIndex}/${total} | ID: \x1b[1m\x1b[33m${ID}\x1b[0m` +
    `\n${color}HTTP Status: ${response.status} - ${response.statusText}\x1b[0m` +
    `\n🕒 Finished at: ${currentTime} — ⏱️  Elapsed: ${elapsedSec}s\n`;

  console.log(log);
  fs.appendFileSync(
    config.path.log,
    log.replace(/\x1b\[[0-9;]*m/g, "") + "-----\n"
  );
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
// Add here any new label you want custom logic for
const DESIGN_LABEL_HANDLERS = {
  "(40) Số công bố và ngày công bố": (row) => {
    const rows = row.querySelectorAll(".row");
    if (rows.length) {
      return Array.from(rows)
        .map((r) =>
          Array.from(r.querySelectorAll(".col-md-4"))
            .map((col) => col.textContent.trim())
            .filter(Boolean)
            .join(" ")
        )
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(30) Chi tiết về dữ liệu ưu tiên": (row) => {
    const blocks = row.querySelectorAll(".priority-table");
    if (blocks.length) {
      return Array.from(blocks)
        .map((block) => {
          const parts = Array.from(block.querySelectorAll(".col-md-6"))
            .map((el) => el.textContent.trim())
            .filter(Boolean);
          return parts.join(" | ");
        })
        .join("<lf>");
    }
    // fallback for rare case
    const parts = Array.from(row.querySelectorAll(".col-md-6, .col-md-4, span"))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    return parts.join(" | ");
  },

  "(51/52) Phân loại Locarno": (row) => {
    const allRows = row.querySelectorAll(".row");
    if (allRows.length) {
      return Array.from(allRows)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(71/73) Chủ đơn/Chủ bằng": (row) => {
    const applicants = row.querySelectorAll(".row");
    if (applicants.length) {
      return Array.from(applicants)
        .map((app) => app.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(72) Tác giả kiểu dáng": (row) => {
    const authors = row.querySelectorAll(".row");
    if (authors.length) {
      return Array.from(authors)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(74) Đại diện SHCN": (row) => {
    const reps = row.querySelectorAll(".row");
    if (reps.length) {
      return Array.from(reps)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },
  // Add more handlers as needed...
};

function extractFromHTML(text, id) {
  const doc = new JSDOM(text).window.document;
  const type = getTypeById(id);

  if (type === "DESIGNS") {
    return extractDesignData(doc, id);
  } else if (type === "PATENTS") {
    return extractPatentData(doc);
  } else {
    return extractTrademarkData(doc);
  }
}

function extractDesignData(doc) {
  const outputPath = outputFiles["DESIGNS"];
  let designData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    // Match label node to the left
    const labelEl = row.previousElementSibling;
    const labelText =
      labelEl && labelEl.classList.contains("product-form-label")
        ? labelEl.textContent.trim()
        : "";

    // If a custom handler exists for this label, use it
    if (DESIGN_LABEL_HANDLERS[labelText]) {
      return DESIGN_LABEL_HANDLERS[labelText](row);
    }

    // All others: plain text
    return row.textContent.trim();
  });

  // Get design image
  let imgURL = "no image";
  let imgTag = doc.querySelector("img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  designData.unshift(imgURL);

  // Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          let columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            let temp = columns[0];
            columns[0] = columns[1];
            columns[1] = temp;
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  // === Hardcoded header for DESIGN (edit as needed) ===
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      [
        "ID",
        "Image",
        "Type",
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
        "(73) Địa chỉ nhận thư",
        "(54) Tên kiểu dáng",
        "Tóm tắt",
        "(53) Tổng số kiểu dáng",
        "(55) Bản chất của kiểu dáng",
        "(56) Yêu cầu bảo hộ kiểu dáng",
        "Tiến trình",
      ].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  let csvContent = designData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}

function extractTrademarkData(doc) {
  const outputPath = outputFiles["TRADEMARKS"];
  let accordion1aData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    // Get the matching label (to the left of the details)
    const labelEl = row.previousElementSibling;
    const labelText =
      labelEl && labelEl.classList.contains("product-form-label")
        ? labelEl.textContent.trim()
        : "";

    // Special handling for (400)
    if (labelText === "(400) Số công bố và ngày công bố") {
      // Each .row inside this cell
      const rows = row.querySelectorAll(".row");
      if (rows.length) {
        return Array.from(rows)
          .map((r) =>
            Array.from(r.querySelectorAll(".col-md-4"))
              .map((col) => col.textContent.trim())
              .filter(Boolean)
              .join(" ")
          )
          .filter(Boolean)
          .join(" | ");
      }
      // fallback: just plain text
      return row.textContent.trim();
    }

    // (300) Priority data, as before
    if (labelText === "(300) Chi tiết về dữ liệu ưu tiên") {
      const parts = Array.from(
        row.querySelectorAll(".col-md-6, .col-md-4, span")
      )
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      return parts.join(" | ");
    }

    // (531) Phân loại hình - as before
    if (labelText === "(531) Phân loại hình") {
      const allRows = row.querySelectorAll(".row");
      if (allRows.length) {
        return Array.from(allRows)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    }

    // Group/class (Nhóm) at index 10 (old code)
    if (index === 10) {
      let combinedText = Array.from(row.querySelectorAll(".row"))
        .map((childRow) => {
          let col2 = childRow.querySelector(".col-md-2");
          let col10 = childRow.querySelector(".col-md-10");
          let col2Text = col2 ? col2.textContent.trim() : "";
          let col10Text = col10 ? col10.textContent.trim() : "";
          // Add zero padding
          let classNum = col2Text.replace(/\D/g, "");
          let classNumPadded = classNum ? classNum.padStart(2, "0") : col2Text;
          return `Class/Nhóm ${classNumPadded}: ${col10Text}`;
        })
        .join("<lf>");
      return combinedText;
    } else {
      return row.textContent.trim();
    }
  });

  // [rest of your function as before...]
  let imgURL = "no image";
  let imgTag = doc.querySelector(".product-form-detail img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  accordion1aData.unshift(imgURL);

  // Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          let columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            let temp = columns[0];
            columns[0] = columns[1];
            columns[1] = temp;
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  // Write header if new or empty
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      [
        "ID",
        "Image",
        "Type",
        "Loại đơn",
        "(100) Số bằng và ngày cấp",
        "Trạng thái",
        "(180) Ngày hết hạn",
        "(200) Số đơn và Ngày nộp đơn",
        "(400) Số công bố và ngày công bố",
        "(541) Nhãn hiệu",
        "(591) Màu sắc nhãn hiệu",
        "(300) Chi tiết về dữ liệu ưu tiên",
        "(511) Nhóm sản phẩm/dịch vụ",
        "(531) Phân loại hình",
        "(730) Chủ đơn/Chủ bằng",
        "(740) Đại diện SHCN",
        "(571) Nhãn hiệu",
        "(566) Nhãn hiệu dịch thuật",
        "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)",
        "(526) Yếu tố loại trừ",
        "Tiến trình",
      ].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  let csvContent = accordion1aData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}

function extractPatentData(doc) {
  const outputPath = outputFiles["PATENTS"];

  // 1. Handler logic defined inside function for scoping
  const PATENT_LABEL_HANDLERS = {
    "(40) Số công bố và ngày công bố": (row) => {
      const rows = row.querySelectorAll(".row");
      if (rows.length) {
        return Array.from(rows)
          .map((r) =>
            Array.from(r.querySelectorAll("div[class^='col-md-']"))
              .map((col) => col.textContent.trim())
              .filter(Boolean)
              .join(" | ")
          )
          .filter(Boolean)
          .join("<lf>");
      }
      return row.textContent.trim();
    },
    "(30) Chi tiết về dữ liệu ưu tiên": (row) => {
      const priorities = row.querySelectorAll(".priority-table");
      if (priorities.length) {
        return Array.from(priorities)
          .map((pt) => {
            const codeDate = Array.from(pt.querySelectorAll(".col-md-6 span"))
              .map((span) => span.textContent.trim())
              .filter(Boolean)
              .join(" ");
            const date =
              pt.querySelectorAll(".col-md-6")[1]?.textContent.trim() || "";
            return [codeDate, date].filter(Boolean).join(" | ");
          })
          .filter(Boolean)
          .join("<lf>");
      }
      return row.textContent.trim();
    },
    "(51) Phân loại IPC": (row) => {
      const ipcList = row.querySelectorAll("ul.classification-ul li");
      if (ipcList.length) {
        return Array.from(ipcList)
          .map((li) => li.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(71/73) Chủ đơn/Chủ bằng": (row) => {
      const applicants = row.querySelectorAll(".row");
      if (applicants.length) {
        return Array.from(applicants)
          .map((app) => app.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(72) Tác giả sáng chế": (row) => {
      const inventors = row.querySelectorAll(".row");
      if (inventors.length) {
        return Array.from(inventors)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(74) Đại diện SHCN": (row) => {
      const reps = row.querySelectorAll(".row");
      if (reps.length) {
        return Array.from(reps)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    // Add more handlers if needed...
  };

  // 2. Field order: must match header
  const FIELD_LABELS = [
    "Loại đơn",
    "Loại đơn PCT",
    "(10) Số bằng và ngày cấp",
    "Trạng thái",
    "(180) Ngày hết hạn",
    "(20) Số đơn và Ngày nộp đơn",
    "(40) Số công bố và ngày công bố",
    "(86) Số đơn và ngày nộp đơn PCT",
    "(87) Số công bố và ngày công bố đơn PCT",
    "(85) Ngày vào pha quốc gia",
    "(30) Chi tiết về dữ liệu ưu tiên",
    "(51) Phân loại IPC",
    "Phân loại CPC",
    "(71/73) Chủ đơn/Chủ bằng",
    "(72) Tác giả sáng chế",
    "(74) Đại diện SHCN",
    "(73) Địa chỉ nhận thư",
    "(54) Tên",
    "(57) Tóm tắt",
    "(58) Các tài liệu đối chứng",
  ];

  // 3. Build label->row map for fast lookup
  const allDetailRows = Array.from(
    doc.querySelectorAll(".product-form-details")
  );
  const labelsByText = {};
  allDetailRows.forEach((row) => {
    const labelEl = row.previousElementSibling;
    if (labelEl && labelEl.classList.contains("product-form-label")) {
      labelsByText[labelEl.textContent.trim()] = row;
    }
  });

  // 4. Collect and order data as per header, using handlers where defined
  let patentData = FIELD_LABELS.map((label) => {
    const row = labelsByText[label];
    if (!row) return ""; // always preserve field order, blanks if missing
    if (PATENT_LABEL_HANDLERS[label]) {
      return PATENT_LABEL_HANDLERS[label](row);
    }
    return row.textContent.trim();
  });

  // 5. Add image URL as second column (after ID)
  let imgURL = "no image";
  let imgTag = doc.querySelector("img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  patentData.unshift(imgURL);

  // 6. Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          let columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            let temp = columns[0];
            columns[0] = columns[1];
            columns[1] = temp;
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  // 7. Write header if needed (ID + Image + all fields + Tiến trình)
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      ["ID", "Image", ...FIELD_LABELS, "Tiến trình"].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  // 8. Return the row
  let csvContent = patentData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}
moveOldOutputs(path.join(__dirname, "Results"), 5);
async function postCheckAndRetry(maxRetries = 3) {
  const originalIDs = fs
    .readFileSync(config.path.data, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const outputIDs = new Set();

  // Read all existing output files
  for (const type of Object.keys(outputFiles)) {
    const outputPath = outputFiles[type];
    if (fs.existsSync(outputPath)) {
      const lines = fs.readFileSync(outputPath, "utf-8").split("\n").slice(1); // Skip header
      for (const line of lines) {
        const id = line.split("\t")[0]?.trim();
        if (id) outputIDs.add(id);
      }
    }
  }

  // Compute difference
  const failedIDs = originalIDs.filter((id) => !outputIDs.has(id));

  if (failedIDs.length === 0) {
    console.log("✅ All IDs successfully processed.");
    return;
  }

  console.log(`🔁 Retrying ${failedIDs.length} failed IDs...`);

  for (let pass = 1; pass <= maxRetries; pass++) {
    console.log(`\n🔁 Retry Pass ${pass}/${maxRetries}`);
    let remaining = [];

    for (let i = 0; i < failedIDs.length; i++) {
      const id = failedIDs[i];
      const url = getUrlById(id);

      try {
        const response = await fetch(url);
        if (response.status === 200) {
          const text = await response.text();
          if (!isTextError(text)) {
            extractDataThenContinue(i, text);
            continue; // success, don't push to remaining
          }
        }
      } catch (err) {
        console.warn(`⚠️ Error fetching ${id}: ${err.message}`);
      }

      remaining.push(id); // still failed
    }

    if (remaining.length === 0) {
      console.log("✅ All previously failed IDs succeeded.");
      return;
    }

    failedIDs.length = 0;
    failedIDs.push(...remaining);
  }

  // Final failure log
  const failLogPath = path.join(baseOutputDir, "final_failed_ids.txt");
  fs.writeFileSync(failLogPath, failedIDs.join("\n"), "utf-8");
  console.log(`❌ Final failed IDs after retries: ${failedIDs.length}`);
  console.log(`📄 Logged to: ${failLogPath}`);
}
async function main() {
  await start();
  await postCheckAndRetry(3); // retry max 3 times
}
main();
