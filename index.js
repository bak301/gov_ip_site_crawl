const fs = require("fs");
const JSDOM = require("jsdom").JSDOM;
const config = require("./config.js");
const IDs = fs.readFileSync(config.path.data, "utf-8").split("\n");

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

  let startTime = performance.now();
  try {
    const response = await fetch(config.BASE_URL + IDs[i]);
    logJobDetails(i, response, IDs, startTime);
    let text = "";
    if (response.status != 200) {
      await handleServerError(
        i,
        retryCount,
        `HTTP Respond  ${response.status} : ${response.statusText}`
      );
    } else {
      text = await response.text();

      if (isTextError(text)) {
        await handleServerError(i, retryCount);
      } else {
        extractDataThenContinue(i, text);
      }
    }
  } catch (error) {
    console.error("Error while fetch:", error);
  }
}

function isTextError(text) {
  return (
    text.includes(config.string.INTERNAL_SERVER_ERROR) ||
    text.includes("${appltype}")
  );
}

async function handleServerError(
  i,
  retryCount,
  reason = "Internal server error"
) {
  if (retryCount < config.RETRY_LIMIT) {
    console.log(`Retrying job number ${i}... Attempt ${retryCount + 1}`);
    await recurse_request(i, retryCount + 1);
  } else {
    console.log(
      `Job number ${i} has failed after ${config.RETRY_LIMIT} attempts. Moving on ....\n`
    );
    fs.appendFileSync(
      config.path.error,
      `ID ${IDs[i].trim()} has failed : ${reason}\n`
    );
    await recurse_request((i += config.THREAD_COUNT));
  }
}

function extractDataThenContinue(i, text) {
  //let outputData = cleanHtml(text);
  let outputData = extractFromHTML(text);
  fs.appendFileSync(config.path.output, outputData);
  recurse_request((i += config.THREAD_COUNT));
}

function logJobDetails(i, response, IDs, startTime) {
  let endTime = performance.now();
  let currentTime = new Date(Date.now()).toLocaleString("vi-VN");
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
  let accordions = new JSDOM(text).window.document.querySelectorAll(
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

function extractFromHTML(text) {
  let doc = new JSDOM(text).window.document;
  let accordion1aData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    if (index === 10) {
      let combinedText = Array.from(row.querySelectorAll(".row"))
        .map((childRow) => {
          let col2Text = childRow.querySelector(".col-md-2").textContent.trim();
          let col10Text = childRow
            .querySelector(".col-md-10")
            .textContent.trim();
          return `Class/Nhóm ${col2Text}: ${col10Text}<lf>`;
        })
        .join("<lf>");
      return combinedText;
    } else {
      return row.textContent;
    }
  });

  let imgURL = "no data !";
  switch (config.DATA_TYPE) {
    case "TRADEMARK":
      imgURL = doc
        .querySelector(".product-form-detail img")
        .getAttribute("src");
      break;

    case "PATENT":
      let imgTag = doc.getElementsByTagName("img")[0];

      if (imgTag != undefined) {
        imgURL = imgTag.getAttribute("src");
      }
      break;
    default:
      break;
  }

  accordion1aData.unshift(imgURL);

  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = Array.from(table.querySelectorAll("tr"))
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
    .join("<lf>");

  let csvContent = accordion1aData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}

start();
