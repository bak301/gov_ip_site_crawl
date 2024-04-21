const LIMIT = 5;
const fs = require("fs");
const base_url =
  "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=";
let dataFile = "ID_Trademark.csv";

async function start() {
  setTimeout(async () => {
    let data = fs.readFileSync("ID_Trademark.csv", "utf-8");
    let array = data.split("\n");
    for (let i = 0; i < LIMIT; i++) {
      let response = await fetch(base_url + array[i]);
      let status = response.status;
      let text = await response.text();

      console.log("ID " + array[i] + " : Response " + status);
      fs.appendFileSync(
        "result.txt",
        response.text + "\n--------------------------------------------------\n"
      );
    }
  }, 1000);
}

start();
