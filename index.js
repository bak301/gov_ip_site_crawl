const LIMIT = 20;
const thread_count = 5;
const fs = require("fs");
const JSDOM = require("jsdom").JSDOM;
const config = require("./config.js");
const IDs = fs.readFileSync(config.DATA_PATH, "utf-8").split("\n");

async function start() {
  const promises = [];
  for (let index = 0; index < thread_count; index++) {
    promises.push(recurse_request(index));
  }
  await Promise.all(promises);
}

async function recurse_request(i, retryCount = 0) {
  if (i >= LIMIT) {
    console.log("request completed");
    return;
  }

  let startTime = performance.now();
  try {
    const response = await fetch(config.BASE_URL + IDs[i]);
    logJobDetails(i, response, IDs, startTime);
    const text = await response.text();

    if (text.includes(config.string.INTERNAL_SERVER_ERROR)) {
      await handleServerError(i, retryCount);
    } else {
      extractDataThenContinue(i, text);
    }
  } catch (error) {
    console.error("Error while fetch:", error);
  }
}

async function handleServerError(i, retryCount) {
  if (retryCount < config.RETRY_LIMIT) {
    console.log(`Retrying job number ${i}... Attempt ${retryCount + 1}`);
    await recurse_request(i, retryCount + 1);
  } else {
    console.log(`Job number ${i} has failed after ${config.RETRY_LIMIT} attempts. Moving on ....\n`);
    fs.appendFileSync("error.html", `ID ${IDs[i].trim()} has failed !\n`);
    await recurse_request((i += thread_count));
  }
}

function extractDataThenContinue(i, text) {
  let outputData = cleanHtml(text);
  fs.appendFileSync("result.html", outputData);
  recurse_request((i += thread_count));
}

function cleanHtml(text) {
  let accordions = new JSDOM(text).window.document.querySelectorAll("#accordion-1a, #accordion-2a, #accordion-3a");
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
  console.log(`\nJob number ${i} has been finished at ${currentTime}`);
  console.log(`HTTP Status : ${response.status} : ${response.statusText}`);
  console.log("ID :" + IDs[i]);
  console.log(`Finish time : ${((endTime - startTime) / 1000).toFixed(2)}s`);
}

start();