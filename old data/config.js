const config = {
  // BASE_URL examples for different data types (trademarks, patents, designs)
  // BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=VN"
  // BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=VN"
  // BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/designs?id=VN"
  BASE_URL:
    "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=VN",
  DATA_TYPE: "PATENT", // Can be "TRADEMARK", "PATENT", or "DESIGN"
  path: {
    data: "ID.csv", // Input file containing IDs
    output: "WIPO_Output.tsv", // Legacy output file for compatibility (not used for dynamic runs)
    error: "error.txt", // Error log for unexpected issues
    log: "log.txt", // Log file for request details
    failedIDs: "failed_ids.txt", // Tracks IDs that failed even after retries
    resultsFolder: "Results", // Folder where all output files are saved dynamically
  },
  RETRY_LIMIT: 10, // Maximum number of retry attempts for failed requests
  TOTAL_REQUEST: 30000, // Total number of requests the script will process
  THREAD_COUNT: 10, // Number of concurrent threads to manage
  delay: {
    BETWEEN_REQUEST: 800, // Time delay (in ms) between consecutive requests
  },
  string: {
    INTERNAL_SERVER_ERROR: "An unexpected server error has occurred", // Helps identify server-side issues
  },
};

module.exports = config;
