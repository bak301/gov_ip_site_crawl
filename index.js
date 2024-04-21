const LIMIT = 5;
const fs = require("fs");
const base_url =
  "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=";
let dataFile = "ID_Trademark.csv";
let data = fs.readFileSync("ID_Trademark.csv", "utf-8");
let array = data.split("\n");
async function start() {
  recurse_request(0);
}

function recurse_request(i) {
  if (i < LIMIT) {
    fetch(base_url + array[i])
      .then((response) => {
        let status = response.status;
        console.log("ID :" + array[i]);
        console.log("\tHTTP Response :  " + status);
        return response.text();
      })
      .then((text) => {
        fs.appendFileSync(
          "result.txt",
          text + "\n--------------------------------------------------\n"
        );
        recurse_request(i + 1); // Fixed increment to i + 1
      })
      .catch((error) => {
        console.error("Error:", error);
      });
  } else {
    console.log("request completed");
  }
}

start();
