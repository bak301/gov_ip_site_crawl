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
    const text = await response.text();

    if (isTextError(text)) {
      await handleServerError(i, retryCount);
    } else {
      extractDataThenContinue(i, text);
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

async function handleServerError(i, retryCount) {
  if (retryCount < config.RETRY_LIMIT) {
    console.log(`Retrying job number ${i}... Attempt ${retryCount + 1}`);
    await recurse_request(i, retryCount + 1);
  } else {
    console.log(
      `Job number ${i} has failed after ${config.RETRY_LIMIT} attempts. Moving on ....\n`
    );
    fs.appendFileSync(config.path.err, `ID ${IDs[i].trim()} has failed !\n`);
    await recurse_request((i += config.THREAD_COUNT));
  }
}

function extractDataThenContinue(i, text) {
  let outputData = cleanHtml(text);
  fs.appendFileSync(config.path.output, outputData);
  recurse_request((i += config.THREAD_COUNT));
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

start();
