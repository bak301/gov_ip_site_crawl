const LIMIT = 10;
const thread_count = 5;

const fs = require("fs");
const { JSDOM } = require("jsdom");
const base_url =
  "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=";
let dataFile = "ID_Trademark.csv";
let data = fs.readFileSync("ID_Trademark.csv", "utf-8");
let array = data.split("\n");

async function start() {
  for (let index = 0; index < thread_count; index++) {
    recurse_request(index);
  }
}

function recurse_request(i) {
  if (i < LIMIT) {
    let startTime = performance.now();
    fetch(base_url + array[i])
      .then((response) => {
        let endTime = performance.now();

        console.log(
          "\nJob number " +
            i +
            " has been finished at " +
            new Date(Date.now()).toLocaleString("vi-VN")
        );
        console.log(
          "HTTP Status : " + response.status + " : " + response.statusText
        );
        console.log("ID :" + array[i]);
        console.log(
          "Finish time : " + ((endTime - startTime) / 1000).toFixed(2) + "s"
        );

        return response.text();
      })
      .then((text) => {
        if (text.includes("An unexpected server error has occurred")) {
          console.log("Job number " + i + "has failed !\n");
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

start();
