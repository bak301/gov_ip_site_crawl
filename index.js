const LIMIT = 20;
const fs = require("fs");
const base_url =
  "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=";
let dataFile = "ID_Trademark.csv";

async function start() {
  let data = fs.readFileSync("ID_Trademark.csv", "utf-8");
  let array = data.split("\n");
  for (let i = 0; i < LIMIT; i++) {
    let data = await fetch(base_url + array[i]);
    fs.appendFileSync(
      "result.txt",
      (await data.text()) +
        "\n--------------------------------------------------\n"
    );
  }
}

start();
