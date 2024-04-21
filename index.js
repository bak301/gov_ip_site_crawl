const LIMIT = 20;
const thread_count = 4;
const fs = require("fs");
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
        let status = response.status;

        console.log("\nJob number " + i + " has done !");
        console.log("ID :" + array[i]);
        console.log(
          "Finish time : " + ((endTime - startTime) / 1000).toFixed(2) + "s"
        );

        return response.text();
      })
      .then((text) => {
        fs.appendFileSync(
          "result.txt",
          text + "\n--------------------------------------------------\n"
        );
        recurse_request((i += thread_count)); // Fixed increment to i + 1
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  } else {
    console.log("request completed");
  }
}

start();
