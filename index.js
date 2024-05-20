const LIMIT = 20;
const thread_count = 5;

const fs = require("fs");
const JSDOM = require("jsdom").JSDOM;
const config = require("./config.js");

let IDs = fs.readFileSync(config.DATA_FILE, "utf-8").split("\n");

async function start() {
  for (let index = 0; index < thread_count; index++) {
    recurse_request(index);
  }
}

function recurse_request(i, retryCount = 0) {
  if (i < LIMIT) {
    let startTime = performance.now();
    fetch(config.BASE_URL + IDs[i])
      .then((response) => {
        logJobDetails(i, response, IDs, startTime);
        return response.text();
      })
      .then((text) => {
        if (text.includes("An unexpected server error has occurred")) {
          if (retryCount < config.RETRY_LIMIT) {
            console.log(
              `Retrying job number ${i}... Attempt ${retryCount + 1}`
            );
            recurse_request(i, retryCount + 1);
          } else {
            console.log(
              `Job number ${i} has failed after ${config.RETRY_LIMIT} attempts. . Moving on ....\n`
            );
            fs.appendFileSync("error.html", `ID ${IDs[i].trim()} has failed !`);
            recurse_request((i += thread_count));
          }
        } else {
          let outputData = cleanHtml(text);
          fs.appendFileSync("result.html", outputData);
          recurse_request((i += thread_count));
        }
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  } else {
    console.log("request completed");
  }
}

function cleanHtml(text) {
  let accordions = new JSDOM(text).window.document.querySelectorAll(
    "#accordion-1a, #accordion-2a, #accordion-3a"
  );
  let cleanedHtml = "";

  accordions.forEach((accordion) => {
    const id = accordion.id; // Extract ID to determine the index
    const i = parseInt(id.substring(id.lastIndexOf("-") + 1, id.length - 1)); // Extract the index from the ID
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
