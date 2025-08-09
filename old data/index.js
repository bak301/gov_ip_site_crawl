const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Enhanced state management
class ScrapingState {
  constructor() {
    this.failedQueue = [];
    this.idTimers = new Map();
    this.idDurations = new Map();
    this.retryTracker = new Map();
    this.idStartTimestamps = new Map();
    this.completedIDs = new Set();
    this.processingIDs = new Set();
    this.permanentlyFailedIDs = new Set();
    this.totalIDsToProcess = 0;
    this.activeThreads = 0;
    this.alreadyScrapedIDs = new Set(); // Track IDs already scraped in existing files
    this.cumulativeCompletedIDs = 0; // Track cumulative completed across retries
    this.currentAttempt = 1; // Track retry attempt number
  }

  markIDAsProcessing(id) {
    this.processingIDs.add(id);
    this.idStartTimestamps.set(id, Date.now());
  }

  markIDAsCompleted(id) {
    this.processingIDs.delete(id);
    this.completedIDs.add(id);
    this.cumulativeCompletedIDs++; // Increment cumulative counter
  }

  markIDAsFailedPermanently(id) {
    this.processingIDs.delete(id);
    this.permanentlyFailedIDs.add(id);
  }

  getElapsedTime(id) {
    const start = this.idStartTimestamps.get(id);
    return start ? ((Date.now() - start) / 1000).toFixed(2) : 'N/A';
  }

  getRetryCount(id) {
    return this.retryTracker.get(id) || 0;
  }

  incrementRetryCount(id) {
    this.retryTracker.set(id, this.getRetryCount(id) + 1);
  }

  // Check if all IDs have been processed (either completed or permanently failed)
  isAllProcessingComplete() {
    const totalProcessed = this.completedIDs.size + this.permanentlyFailedIDs.size;
    return totalProcessed >= this.totalIDsToProcess;
  }

  // Get current processing statistics
  getStats() {
    return {
      completed: this.completedIDs.size,
      permanentlyFailed: this.permanentlyFailedIDs.size,
      processing: this.processingIDs.size,
      total: this.totalIDsToProcess,
      remaining: this.totalIDsToProcess - this.completedIDs.size - this.permanentlyFailedIDs.size
    };
  }
}

const scrapingState = new ScrapingState();

// Global timer for progress tracking
let globalStartTime = Date.now();

// === Helper function to get today's date in YYYY-MM-DD format ===
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// === Set up date-based output folder with WIPO_ prefix
const todayDate = getTodayDateString();
const baseOutputDir = path.join(__dirname, "Results", `WIPO_${todayDate}`);
fs.mkdirSync(baseOutputDir, { recursive: true });

// === Function to extract already scraped IDs from existing output files ===
function extractScrapedIDsFromFile(filePath) {
  const scrapedIDs = new Set();
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Look for ID patterns in the content (format: 1-YYYY-XXXXX, 2-YYYY-XXXXX, etc.)
        const idMatch = line.match(/(?:^|\W)([1-4]-\d{4}-\d{5})(?:\W|$)/);
        if (idMatch) {
          scrapedIDs.add(idMatch[1]);
        }
      }
      
      console.log(`📋 Found ${scrapedIDs.size} already scraped IDs in ${path.basename(filePath)}`);
    } catch (error) {
      console.log(`⚠️ Error reading existing file ${filePath}: ${error.message}`);
    }
  }
  return scrapedIDs;
}

// === Function to check all existing output files for scraped IDs ===
function loadAlreadyScrapedIDs() {
  console.log(`🔍 Checking for existing output files in ${baseOutputDir}...`);
  
  const outputFolders = {
    PATENTS: path.join(baseOutputDir, "Patents"),
    TRADEMARKS: path.join(baseOutputDir, "Trademarks"),
    DESIGNS: path.join(baseOutputDir, "Designs"),
  };

  // Create folders if they don't exist
  Object.values(outputFolders).forEach((folder) => {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  });

  const outputFiles = {
    PATENTS: path.join(outputFolders.PATENTS, `WIPO_${todayDate}_Patents.txt`),
    TRADEMARKS: path.join(outputFolders.TRADEMARKS, `WIPO_${todayDate}_Trademarks.txt`),
    DESIGNS: path.join(outputFolders.DESIGNS, `WIPO_${todayDate}_Designs.txt`),
  };

  // Check each output file for already scraped IDs
  Object.entries(outputFiles).forEach(([type, filePath]) => {
    const scrapedIDs = extractScrapedIDsFromFile(filePath);
    scrapedIDs.forEach(id => scrapingState.alreadyScrapedIDs.add(id));
  });

  console.log(`✅ Total already scraped IDs found: ${scrapingState.alreadyScrapedIDs.size}`);
  return { outputFolders, outputFiles };
}
function extractHeadersFromDoc(doc) {
  const labelNodes = doc.querySelectorAll(".product-form-label");
  const headers = Array.from(labelNodes).map((el) => el.textContent.trim());
  const uniqueHeaders = [...new Set(headers)];
  return uniqueHeaders;
}

// Enhanced configuration with better organization
const config = {
  BASE_URLS: {
    PATENTS:
      "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=VN",
    DESIGNS:
      "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/designs?id=VN",
    TRADEMARKS:
      "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=VN",
  },
  DATA_TYPE: "TRADEMARK", // default fallback for extract logic
  path: {
    data: "ID.csv",
    log: path.join(baseOutputDir, "log.txt"),
    failedIDs: "failed_ids.txt",
  },
  THREAD_COUNT: 12, // Increased from 16 for better performance
  RETRY_LIMIT: 20, // Reduced from 30 for faster processing
  MAX_CONCURRENT_REQUESTS: 8, // New: limit concurrent requests
  delay: {
    BETWEEN_REQUEST: 1500, // Reduced delay
    RETRY_DELAY_BASE: 2000, // Base delay for retries
    RETRY_DELAY_MULTIPLIER: 1.5, // Exponential backoff multiplier
  },
  string: {
    INTERNAL_SERVER_ERROR: "An unexpected server error has occurred",
    TEMPLATE_ERROR: "${appltype}", // Another error indicator
  },
  timeout: {
    REQUEST_TIMEOUT: 30000, // 30 seconds timeout per request
    TOTAL_TIMEOUT: 7200000, // 2 hours total timeout
  },
};

// === Initialize output structure and check for existing data ===
const { outputFolders, outputFiles } = loadAlreadyScrapedIDs();

// === Load IDs and filter out already scraped ones ===
console.log(`📂 Loading IDs from ${config.path.data}...`);
const allIDs = fs
  .readFileSync(config.path.data, "utf-8")
  .split("\n")
  .filter(Boolean);

console.log(`📋 Total IDs in file: ${allIDs.length}`);

// Filter out already scraped IDs
let IDs = allIDs.filter(id => !scrapingState.alreadyScrapedIDs.has(id));

console.log(`✅ IDs to process (excluding already scraped): ${IDs.length}`);
console.log(`⏭️ Skipped IDs (already scraped): ${allIDs.length - IDs.length}`);

config.TOTAL_REQUEST = IDs.length;

// === Copy original ID list
fs.copyFileSync(config.path.data, path.join(baseOutputDir, "original_ID.csv"));

function getTypeById(id) {
  const prefix = id.split("-")[0];
  switch (prefix) {
    case "1":
    case "2":
      return "PATENTS";
    case "3":
      return "DESIGNS";
    case "4":
      return "TRADEMARKS";
    default:
      return "TRADEMARKS";
  }
}

function getUrlById(id) {
  const type = getTypeById(id);
  return config.BASE_URLS[type] + id.replace(/-/g, "");
}

// === Get output file path for a specific type ===
function getOutputFileForType(type) {
  return outputFiles[type];
}

// Function to check if all processing is complete
function checkProcessingComplete() {
  const stats = scrapingState.getStats();
  
  console.log(`\n============================================================`);
  console.log(`📊 PROCESSING STATUS CHECK`);
  console.log(`============================================================`);
  console.log(`✅ Successfully processed: ${stats.completed} IDs`);
  console.log(`❌ Permanently failed: ${stats.permanentlyFailed} IDs`);
  console.log(`⏳ Still processing: ${stats.processing} IDs`);
  console.log(`📋 Total IDs: ${stats.total}`);
  console.log(`📈 Success rate: ${((stats.completed / stats.total) * 100).toFixed(1)}%`);
  console.log(`============================================================\n`);
  
  if (scrapingState.isAllProcessingComplete()) {
    console.log(`🎉 All IDs have been processed!`);
    generateFinalReport();
  } else {
    console.log(`⏳ Still processing ${stats.remaining} IDs...`);
  }
}

// Enhanced progress logging with dynamic display
function logProgress(currentIndex, currentID, response, elapsedTime) {
  const now = Date.now();
  const totalElapsed = ((now - globalStartTime) / 1000);
  
  // Calculate time in human-readable format
  const hours = Math.floor(totalElapsed / 3600);
  const minutes = Math.floor((totalElapsed % 3600) / 60);
  const seconds = Math.floor(totalElapsed % 60);
  
  let timeStr;
  if (hours > 0) {
    timeStr = `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    timeStr = `${minutes}m ${seconds}s`;
  } else {
    timeStr = `${seconds}s`;
  }
  
  // Calculate averages using cumulative tracking
  const avgPerSecond = scrapingState.cumulativeCompletedIDs > 0 ? 
    (scrapingState.cumulativeCompletedIDs / totalElapsed).toFixed(2) : '0.00';
  
  const statusText = response.status === 200 ? 
    `\x1b[32m${response.status} - ${response.statusText}\x1b[0m` : 
    `\x1b[31m${response.status} - ${response.statusText}\x1b[0m`;
  
  const retryCount = scrapingState.getRetryCount(currentID);
  const retryText = retryCount > 0 ? ` | \x1b[33mRetries: ${retryCount}\x1b[0m` : '';
  
  // Clear previous lines and display new progress (4 lines)
  process.stdout.write('\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\r');
  
  console.log(`\x1b[1m${String(currentIndex + 1).padStart(3, ' ')}/${IDs.length}: ${currentID}\x1b[0m | Status: ${statusText}${retryText}`);
  console.log(`\x1b[36mTime: ${timeStr}\x1b[0m | \x1b[33mAvg: ${avgPerSecond}/s\x1b[0m | \x1b[33mRequest: ${elapsedTime}ms\x1b[0m`);
  console.log(`\x1b[32mCompleted: ${scrapingState.cumulativeCompletedIDs}\x1b[0m | Processing: ${scrapingState.processingIDs.size} | Remaining: ${IDs.length - scrapingState.completedIDs.size}`);
  console.log(`\x1b[34mThreads: ${config.THREAD_COUNT} | Retry Limit: ${config.RETRY_LIMIT} | Attempt: ${scrapingState.currentAttempt}\x1b[0m`);
}

// Enhanced main start function with better retry logic
async function start() {
  console.log(`🚀 Starting scraping process with ${config.THREAD_COUNT} threads...`);
  console.log(`📋 Total IDs to process: ${IDs.length}`);
  console.log(`⚙️ Configuration: ${config.RETRY_LIMIT} max retries, ${config.delay.BETWEEN_REQUEST}ms base delay\n`);

  // Initialize state
  scrapingState.totalIDsToProcess = IDs.length;
  scrapingState.activeThreads = config.THREAD_COUNT;

  const startTime = Date.now();
  
  // Create thread promises
  const promises = [];
  for (let index = 0; index < config.THREAD_COUNT; index++) {
    promises.push(recurse_request(index));
  }
  
  // Wait for all initial threads to complete
  try {
    await Promise.all(promises);
    console.log(`✅ Initial processing completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
  } catch (error) {
    console.error(`❌ Error during initial processing:`, error);
  }

  // Handle failed IDs with retry
  if (scrapingState.failedQueue.length > 0) {
    console.log(`\n🔁 Retrying ${scrapingState.failedQueue.length} failed IDs...`);
    
    const retryStartTime = Date.now();
    const retryIDs = [...scrapingState.failedQueue];
    scrapingState.failedQueue = [];
    IDs = retryIDs;

    // Reset processing state for retries
    retryIDs.forEach(id => {
      scrapingState.processingIDs.delete(id);
      scrapingState.markIDAsProcessing(id);
    });

    const retryPromises = [];
    for (let index = 0; index < Math.min(config.THREAD_COUNT, retryIDs.length); index++) {
      retryPromises.push(recurse_request(index, 0));
    }
    
    try {
      await Promise.all(retryPromises);
      console.log(`✅ Retry phase completed in ${((Date.now() - retryStartTime) / 1000).toFixed(2)}s`);
    } catch (error) {
      console.error(`❌ Error during retry phase:`, error);
    }

    // Final failed IDs handling
    await handleFinalFailedIDs();
  }

  // Print initial processing statistics
  printFinalStatistics(startTime);
}
// Helper function to handle final failed IDs
async function handleFinalFailedIDs() {
  const failIdPath = path.join(baseOutputDir, "fail_id.txt");
  
  if (scrapingState.failedQueue.length > 0) {
    console.log(`\n❌ Final failed IDs (${scrapingState.failedQueue.length}) after all retries:`);
    
    // Log each failed ID with details
    for (const id of scrapingState.failedQueue) {
      const type = getTypeById(id);
      const retryCount = scrapingState.getRetryCount(id);
      const elapsedTime = scrapingState.getElapsedTime(id);
      
      console.log(`   • ${id} (${type}) - ${retryCount} retries, ${elapsedTime}s elapsed`);
      
      const noDataEntry = `${id}\tNo data available after ${retryCount} retries\n`;
      fs.appendFileSync(outputFiles[type], noDataEntry);
      fs.appendFileSync(config.path.failedIDs, `${id}\n`);
      fs.appendFileSync(failIdPath, `${id}\n`);
    }
  } else {
    console.log(`\n✅ All previously failed IDs succeeded on retry!`);
  }
}

// Function to generate final report
function generateFinalReport() {
  const stats = scrapingState.getStats();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 FINAL PROCESSING REPORT`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Successfully processed: ${stats.completed} IDs`);
  console.log(`❌ Permanently failed: ${stats.permanentlyFailed} IDs`);
  console.log(`📋 Total IDs: ${stats.total}`);
  console.log(`📈 Success rate: ${((stats.completed / stats.total) * 100).toFixed(1)}%`);
  console.log(`🧵 Threads used: ${config.THREAD_COUNT}`);
  console.log(`🔄 Max retries per ID: ${config.RETRY_LIMIT}`);
  console.log(`📁 Output directory: ${baseOutputDir}`);
  
  if (stats.permanentlyFailed > 0) {
    console.log(`\n❌ Permanently failed IDs:`);
    scrapingState.permanentlyFailedIDs.forEach(id => {
      console.log(`   - ${id} (${scrapingState.getRetryCount(id)} retries)`);
    });
  }
  
  console.log(`${'='.repeat(60)}\n`);
  
  // Write final report to file
  const reportPath = path.join(baseOutputDir, "processing_report.txt");
  const reportContent = [
    `WIPO Scraping Final Report`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Statistics:`,
    `- Successfully processed: ${stats.completed} IDs`,
    `- Permanently failed: ${stats.permanentlyFailed} IDs`,
    `- Total IDs: ${stats.total}`,
    `- Success rate: ${((stats.completed / stats.total) * 100).toFixed(1)}%`,
    ``,
    `Configuration:`,
    `- Threads used: ${config.THREAD_COUNT}`,
    `- Max retries per ID: ${config.RETRY_LIMIT}`,
    `- Base delay: ${config.delay.BETWEEN_REQUEST}ms`,
    ``,
    ...(stats.permanentlyFailed > 0 ? [
      `Permanently Failed IDs:`,
      ...Array.from(scrapingState.permanentlyFailedIDs).map(id => 
        `- ${id} (${scrapingState.getRetryCount(id)} retries)`
      )
    ] : [])
  ].join('\n');
  
  fs.writeFileSync(reportPath, reportContent);
  console.log(`📄 Final report saved to: ${reportPath}`);
}

// Function to print final statistics (legacy function for compatibility)
function printFinalStatistics(startTime) {
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const stats = scrapingState.getStats();
  const successRate = stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : 0;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 INITIAL PROCESSING STATISTICS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`⏱️  Total execution time: ${totalTime}s`);
  console.log(`✅ Successfully processed: ${stats.completed} IDs`);
  console.log(`❌ Permanently failed: ${stats.permanentlyFailed} IDs`);
  console.log(`⏳ Still processing: ${stats.processing} IDs (will be handled in post-processing)`);
  console.log(`📈 Current success rate: ${successRate}%`);
  console.log(`⚡ Average time per successful ID: ${stats.completed > 0 ? (parseFloat(totalTime) / stats.completed).toFixed(2) : 'N/A'}s`);
  console.log(`🧵 Threads used: ${config.THREAD_COUNT}`);
  console.log(`🔄 Max retries per ID: ${config.RETRY_LIMIT}`);
  console.log(`📁 Output directory: ${baseOutputDir}`);
  console.log(`${'='.repeat(60)}\n`);
}

function moveOldOutputs(outputDir, keep = 5) {
  try {
    const oldDir = path.join(outputDir, "Old");
    
    // Create Old directory if it doesn't exist
    if (!fs.existsSync(oldDir)) {
      fs.mkdirSync(oldDir, { recursive: true });
    }

    const entries = fs
      .readdirSync(outputDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "Old")
      .sort((a, b) => {
        try {
          const aTime = fs.statSync(path.join(outputDir, a.name)).mtimeMs;
          const bTime = fs.statSync(path.join(outputDir, b.name)).mtimeMs;
          return bTime - aTime;
        } catch (err) {
          console.warn(`⚠️ Error reading stats for ${a.name || b.name}: ${err.message}`);
          return 0;
        }
      });

    const toMove = entries.slice(keep);
    let movedCount = 0;
    
    for (const dir of toMove) {
      const src = path.join(outputDir, dir.name);
      const dest = path.join(oldDir, dir.name);
      try {
        // Check if destination already exists
        if (fs.existsSync(dest)) {
          console.log(`📦 Skipping ${dir.name} - already exists in /Old`);
          continue;
        }
        
        fs.renameSync(src, dest);
        console.log(`📦 Moved old output: ${dir.name} → /Old`);
        movedCount++;
      } catch (err) {
        if (err.code === 'EPERM') {
          console.warn(`⚠️ Permission denied moving ${dir.name} - skipping (files may be in use)`);
        } else {
          console.warn(`⚠️ Failed to move ${dir.name}: ${err.message}`);
        }
      }
    }
    
    if (movedCount > 0) {
      console.log(`✅ Successfully moved ${movedCount} old output directories`);
    }
  } catch (error) {
    console.warn(`⚠️ Error during cleanup of old outputs: ${error.message}`);
    console.log(`ℹ️ Continuing with script execution...`);
  }
}

// Enhanced main processing function with better error handling
async function recurse_request(i, retryCount = 0) {
  if (i >= IDs.length) {
    scrapingState.activeThreads--;
    console.log(`✅ Thread completed processing all assigned IDs (Active threads: ${scrapingState.activeThreads})`);
    
    // Check if all processing is complete
    if (scrapingState.activeThreads === 0) {
      console.log(`🏁 All threads completed. Checking final status...`);
      checkProcessingComplete();
    }
    return;
  }

  const currentID = IDs[i].trim();
  
  // Validate ID format
  if (!utils.isValidID(currentID)) {
    console.warn(`⚠️ Invalid ID format: ${currentID}, skipping...`);
    await recurse_request(i + config.THREAD_COUNT, 0);
    return;
  }

  // Check if already processing or completed
  if (scrapingState.processingIDs.has(currentID) || scrapingState.completedIDs.has(currentID) || scrapingState.permanentlyFailedIDs.has(currentID)) {
    await recurse_request(i + config.THREAD_COUNT, 0);
    return;
  }

  // Mark as processing and apply rate limiting
  scrapingState.markIDAsProcessing(currentID);
  await utils.rateLimiter();

  const url = getUrlById(currentID);
  const startTime = performance.now();

  try {
    // Create timeout promise
    const timeoutPromise = utils.createTimeoutPromise(config.timeout.REQUEST_TIMEOUT);
    
    // Race between fetch and timeout
    const response = await Promise.race([
      fetch(url),
      timeoutPromise
    ]);

    logJobDetails(i, response, IDs, startTime);

    if (response.status !== 200) {
      await handleServerError(i, retryCount, currentID);
    } else {
      const text = await response.text();
      if (isTextError(text)) {
        await handleServerError(i, retryCount, currentID);
      } else {
        extractDataThenContinue(i, text);
      }
    }
  } catch (error) {
    const errorMsg = error.message || 'Unknown error';
    console.error(`❌ Error processing ID ${currentID}:`, errorMsg);
    
    // Log error details
    const errorLog = `Error for ID ${currentID}: ${errorMsg} at ${new Date().toISOString()}\n`;
    fs.appendFileSync(config.path.log, errorLog);
    
    await handleServerError(i, retryCount, currentID);
  }
}

// Enhanced error detection
function isTextError(text) {
  if (!text || typeof text !== 'string') return true;
  
  const errorIndicators = [
    config.string.INTERNAL_SERVER_ERROR,
    config.string.TEMPLATE_ERROR,
    'error',
    'exception',
    'not found',
    '404',
    '500',
    '502',
    '503',
    'gateway timeout'
  ];
  
  const lowerText = text.toLowerCase();
  return errorIndicators.some(indicator => lowerText.includes(indicator.toLowerCase()));
}

// Enhanced error handling with exponential backoff
async function handleServerError(i, retryCount, id) {
  scrapingState.incrementRetryCount(id);
  
  if (retryCount < config.RETRY_LIMIT) {
    // Calculate exponential backoff delay
    const baseDelay = utils.getRetryDelay(retryCount);
    const jitteredDelay = baseDelay + (Math.random() * 1000); // Add jitter
    
    const retryColor = 
      retryCount < 3 ? "\x1b[32m" : 
      retryCount < 6 ? "\x1b[33m" : 
      "\x1b[31m";
    
    console.log(
      `\x1b[90m🔄 INDIVIDUAL RETRY: \x1b[0m${retryColor}${id} (Attempt ${retryCount + 1}/${config.RETRY_LIMIT}) - waiting ${(jitteredDelay/1000).toFixed(1)}s\x1b[0m`
    );

    // Wait before retry with exponential backoff
    await utils.delay(jitteredDelay);
    await recurse_request(i, retryCount + 1);
  } else {
    console.log(
      `❌ ID ${id} failed permanently after ${config.RETRY_LIMIT} attempts\n`
    );

    // Mark as permanently failed
    scrapingState.markIDAsFailedPermanently(id);

    // Add to failed queue if not already present
    if (!scrapingState.failedQueue.includes(id)) {
      scrapingState.failedQueue.push(id);
    }

    // Continue with next ID
    await recurse_request(i + config.THREAD_COUNT, 0);
  }
}

// Enhanced data extraction with better error handling
function extractDataThenContinue(i, text) {
  const currentID = IDs[i].trim();
  
  try {
    // Check if this ID was already processed to prevent duplicates
    if (scrapingState.alreadyScrapedIDs.has(currentID)) {
      console.log(`⏭️ Skipping ${currentID} - already processed`);
      scrapingState.markIDAsCompleted(currentID);
      return;
    }
    
    const outputData = extractFromHTML(text, currentID);
    const type = getTypeById(currentID);
    const formattedData = `${currentID}\t${outputData}`;
    
    // Add to already scraped set to prevent future duplicates
    scrapingState.alreadyScrapedIDs.add(currentID);
    
    // Thread-safe file writing
    fs.appendFileSync(outputFiles[type], formattedData);
    
    // Log completion time
    const elapsedTime = scrapingState.getElapsedTime(currentID);
    console.log(`✅ ID ${currentID} processed successfully - elapsed: ${elapsedTime}s`);
    
    // Mark as completed
    scrapingState.markIDAsCompleted(currentID);
    
    // Update progress
    const stats = scrapingState.getStats();
    const percentage = ((stats.completed / stats.total) * 100).toFixed(1);
    
    if (stats.completed % 10 === 0) { // Log progress every 10 completions
      console.log(`📊 Progress: ${stats.completed}/${stats.total} (${percentage}%) completed`);
    }

    // Check if all processing is complete
    if (scrapingState.isAllProcessingComplete()) {
      console.log(`🎉 All processing complete! Generating final report...`);
      generateFinalReport();
    }

  } catch (error) {
    console.error(`❌ Error extracting data for ID ${currentID}:`, error.message);
    scrapingState.markIDAsFailedPermanently(currentID);
    scrapingState.failedQueue.push(currentID);
  }

  // Continue with next ID
  recurse_request(i + config.THREAD_COUNT, 0);
}

// Enhanced logging with better formatting and performance tracking
function logJobDetails(i, response, IDs, startTime) {
  const endTime = performance.now();
  const requestDuration = (endTime - startTime).toFixed(2);
  const currentTime = new Date().toLocaleString("vi-VN");

  const ID = IDs[i].trim();
  const stats = scrapingState.getStats();

  const statusColor = response.status === 200 ? "\x1b[32m" : "\x1b[1m\x1b[31m";
  const elapsedTime = scrapingState.getElapsedTime(ID);
  const retryCount = scrapingState.getRetryCount(ID);
  
  // Calculate ETA based on current progress
  const avgTimePerRequest = stats.completed > 0 ? (Date.now() - scrapingState.idStartTimestamps.values().next().value) / stats.completed : 0;
  const eta = stats.remaining > 0 ? new Date(Date.now() + (stats.remaining * avgTimePerRequest)).toLocaleTimeString("vi-VN") : "N/A";

  const log =
    `\n📊 Processing ID: \x1b[1m\x1b[33m${ID}\x1b[0m` +
    `${statusColor} | Status: ${response.status} - ${response.statusText}\x1b[0m` +
    `\n🕒 ${currentTime} | ⏱️ Request: ${requestDuration}ms | Total: ${elapsedTime}s` +
    `${retryCount > 0 ? ` | 🔄 Retries: ${retryCount}` : ''}` +
    `\n📈 Completed: ${stats.completed}/${stats.total} | ❌ Failed: ${stats.permanentlyFailed} | ⏳ Processing: ${stats.processing} | ETA: ${eta}\n`;

  console.log(log);
  
  // Clean log for file (remove ANSI colors)
  const cleanLog = log.replace(/\x1b\[[0-9;]*m/g, "") + "-----\n";
  fs.appendFileSync(config.path.log, cleanLog);
}

// Enhanced utility functions
const utils = {
  /**
   * Creates a delay with optional jitter to prevent thundering herd
   */
  delay: (ms, jitter = 0.1) => {
    const jitterAmount = ms * jitter * Math.random();
    return new Promise(resolve => setTimeout(resolve, ms + jitterAmount));
  },

  /**
   * Calculates exponential backoff delay for retries
   */
  getRetryDelay: (attempt) => {
    return config.delay.RETRY_DELAY_BASE * Math.pow(config.delay.RETRY_DELAY_MULTIPLIER, attempt);
  },

  /**
   * Validates if an ID has the correct format (supports both formats: 1-2021-04006 or 1-04006)
   */
  isValidID: (id) => {
    if (!id || typeof id !== 'string') return false;
    const trimmedId = id.trim();
    if (trimmedId.length === 0) return false;
    
    // Support both formats: 1-2021-04006 (with year) or 1-04006 (without year)
    return /^\d+-(\d{4}-)?(\d{4,})$/.test(trimmedId);
  },

  /**
   * Safely parses JSON with error handling
   */
  safeJSONParse: (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },

  /**
   * Creates a timeout promise that rejects after specified time
   */
  createTimeoutPromise: (ms) => {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
  },

  /**
   * Rate limiter using a simple queue
   */
  rateLimiter: (() => {
    let queue = [];
    let processing = false;

    const processQueue = async () => {
      if (processing || queue.length === 0) return;
      
      processing = true;
      while (queue.length > 0) {
        const { resolve } = queue.shift();
        resolve();
        await utils.delay(config.delay.BETWEEN_REQUEST);
      }
      processing = false;
    };

    return () => {
      return new Promise(resolve => {
        queue.push({ resolve });
        processQueue();
      });
    };
  })(),
};

function delay(ms) {
  return utils.delay(ms);
}

function cleanHtml(text) {
  const accordions = new JSDOM(text).window.document.querySelectorAll(
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
// Add here any new label you want custom logic for
const DESIGN_LABEL_HANDLERS = {
  "(40) Số công bố và ngày công bố": (row) => {
    const rows = row.querySelectorAll(".row");
    if (rows.length) {
      return Array.from(rows)
        .map((r) =>
          Array.from(r.querySelectorAll(".col-md-4"))
            .map((col) => col.textContent.trim())
            .filter(Boolean)
            .join(" ")
        )
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(30) Chi tiết về dữ liệu ưu tiên": (row) => {
    const blocks = row.querySelectorAll(".priority-table");
    if (blocks.length) {
      return Array.from(blocks)
        .map((block) => {
          const parts = Array.from(block.querySelectorAll(".col-md-6"))
            .map((el) => el.textContent.trim())
            .filter(Boolean);
          return parts.join(" | ");
        })
        .join("<lf>");
    }
    // fallback for rare case
    const parts = Array.from(row.querySelectorAll(".col-md-6, .col-md-4, span"))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    return parts.join(" | ");
  },

  "(51/52) Phân loại Locarno": (row) => {
    const allRows = row.querySelectorAll(".row");
    if (allRows.length) {
      return Array.from(allRows)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(71/73) Chủ đơn/Chủ bằng": (row) => {
    const applicants = row.querySelectorAll(".row");
    if (applicants.length) {
      return Array.from(applicants)
        .map((app) => app.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(72) Tác giả kiểu dáng": (row) => {
    const authors = row.querySelectorAll(".row");
    if (authors.length) {
      return Array.from(authors)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(74) Đại diện SHCN": (row) => {
    const reps = row.querySelectorAll(".row");
    if (reps.length) {
      return Array.from(reps)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },
  // Add more handlers as needed...
};

function extractFromHTML(text, id) {
  const doc = new JSDOM(text).window.document;
  const type = getTypeById(id);

  if (type === "DESIGNS") {
    return extractDesignData(doc, id);
  } else if (type === "PATENTS") {
    return extractPatentData(doc);
  } else {
    return extractTrademarkData(doc);
  }
}

function extractDesignData(doc) {
  const outputPath = outputFiles["DESIGNS"];
  let designData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    // Match label node to the left
    const labelEl = row.previousElementSibling;
    const labelText =
      labelEl && labelEl.classList.contains("product-form-label")
        ? labelEl.textContent.trim()
        : "";

    // If a custom handler exists for this label, use it
    if (DESIGN_LABEL_HANDLERS[labelText]) {
      return DESIGN_LABEL_HANDLERS[labelText](row);
    }

    // All others: plain text
    return row.textContent.trim();
  });

  // Get design image
  let imgURL = "no image";
  let imgTag = doc.querySelector("img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  designData.unshift(imgURL);

  // Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
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
        .join("<lf>")
    : "no table data";

  // === Hardcoded header for DESIGN (edit as needed) ===
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      [
        "ID",
        "Image",
        "Type",
        "Loại đơn",
        "(10) Số bằng và ngày cấp",
        "Trạng thái",
        "(180) Ngày hết hạn",
        "(20) Số đơn và Ngày nộp đơn",
        "(40) Số công bố và ngày công bố",
        "(30) Chi tiết về dữ liệu ưu tiên",
        "(51/52) Phân loại Locarno",
        "(71/73) Chủ đơn/Chủ bằng",
        "(72) Tác giả kiểu dáng",
        "(74) Đại diện SHCN",
        "(73) Địa chỉ nhận thư",
        "(54) Tên kiểu dáng",
        "Tóm tắt",
        "(53) Tổng số kiểu dáng",
        "(55) Bản chất của kiểu dáng",
        "(56) Yêu cầu bảo hộ kiểu dáng",
        "Tiến trình",
      ].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  let csvContent = designData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}

function extractTrademarkData(doc) {
  const outputPath = outputFiles["TRADEMARKS"];
  let accordion1aData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    // Get the matching label (to the left of the details)
    const labelEl = row.previousElementSibling;
    const labelText =
      labelEl && labelEl.classList.contains("product-form-label")
        ? labelEl.textContent.trim()
        : "";

    // Special handling for (400)
    if (labelText === "(400) Số công bố và ngày công bố") {
      // Each .row inside this cell
      const rows = row.querySelectorAll(".row");
      if (rows.length) {
        return Array.from(rows)
          .map((r) =>
            Array.from(r.querySelectorAll(".col-md-4"))
              .map((col) => col.textContent.trim())
              .filter(Boolean)
              .join(" ")
          )
          .filter(Boolean)
          .join(" | ");
      }
      // fallback: just plain text
      return row.textContent.trim();
    }

    // (300) Priority data, as before
    if (labelText === "(300) Chi tiết về dữ liệu ưu tiên") {
      const parts = Array.from(
        row.querySelectorAll(".col-md-6, .col-md-4, span")
      )
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      return parts.join(" | ");
    }

    // (531) Phân loại hình - as before
    if (labelText === "(531) Phân loại hình") {
      const allRows = row.querySelectorAll(".row");
      if (allRows.length) {
        return Array.from(allRows)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    }

    // Group/class (Nhóm) at index 10 (old code)
    if (index === 10) {
      let combinedText = Array.from(row.querySelectorAll(".row"))
        .map((childRow) => {
          let col2 = childRow.querySelector(".col-md-2");
          let col10 = childRow.querySelector(".col-md-10");
          let col2Text = col2 ? col2.textContent.trim() : "";
          let col10Text = col10 ? col10.textContent.trim() : "";
          // Add zero padding
          let classNum = col2Text.replace(/\D/g, "");
          let classNumPadded = classNum ? classNum.padStart(2, "0") : col2Text;
          return `Class/Nhóm ${classNumPadded}: ${col10Text}`;
        })
        .join("<lf>");
      return combinedText;
    } else {
      return row.textContent.trim();
    }
  });

  // [rest of your function as before...]
  let imgURL = "no image";
  let imgTag = doc.querySelector(".product-form-detail img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  accordion1aData.unshift(imgURL);

  // Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
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
        .join("<lf>")
    : "no table data";

  // Write header if new or empty
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      [
        "ID",
        "Image",
        "Type",
        "Loại đơn",
        "(100) Số bằng và ngày cấp",
        "Trạng thái",
        "(180) Ngày hết hạn",
        "(200) Số đơn và Ngày nộp đơn",
        "(400) Số công bố và ngày công bố",
        "(541) Nhãn hiệu",
        "(591) Màu sắc nhãn hiệu",
        "(300) Chi tiết về dữ liệu ưu tiên",
        "(511) Nhóm sản phẩm/dịch vụ",
        "(531) Phân loại hình",
        "(730) Chủ đơn/Chủ bằng",
        "(740) Đại diện SHCN",
        "(571) Nhãn hiệu",
        "(566) Nhãn hiệu dịch thuật",
        "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)",
        "(526) Yếu tố loại trừ",
        "Tiến trình",
      ].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  let csvContent = accordion1aData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}

function extractPatentData(doc) {
  const outputPath = outputFiles["PATENTS"];

  // 1. Handler logic defined inside function for scoping
  const PATENT_LABEL_HANDLERS = {
    "(40) Số công bố và ngày công bố": (row) => {
      const rows = row.querySelectorAll(".row");
      if (rows.length) {
        return Array.from(rows)
          .map((r) =>
            Array.from(r.querySelectorAll("div[class^='col-md-']"))
              .map((col) => col.textContent.trim())
              .filter(Boolean)
              .join(" | ")
          )
          .filter(Boolean)
          .join("<lf>");
      }
      return row.textContent.trim();
    },
    "(30) Chi tiết về dữ liệu ưu tiên": (row) => {
      const priorities = row.querySelectorAll(".priority-table");
      if (priorities.length) {
        return Array.from(priorities)
          .map((pt) => {
            const codeDate = Array.from(pt.querySelectorAll(".col-md-6 span"))
              .map((span) => span.textContent.trim())
              .filter(Boolean)
              .join(" ");
            const date =
              pt.querySelectorAll(".col-md-6")[1]?.textContent.trim() || "";
            return [codeDate, date].filter(Boolean).join(" | ");
          })
          .filter(Boolean)
          .join("<lf>");
      }
      return row.textContent.trim();
    },
    "(51) Phân loại IPC": (row) => {
      const ipcList = row.querySelectorAll("ul.classification-ul li");
      if (ipcList.length) {
        return Array.from(ipcList)
          .map((li) => li.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(71/73) Chủ đơn/Chủ bằng": (row) => {
      const applicants = row.querySelectorAll(".row");
      if (applicants.length) {
        return Array.from(applicants)
          .map((app) => app.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(72) Tác giả sáng chế": (row) => {
      const inventors = row.querySelectorAll(".row");
      if (inventors.length) {
        return Array.from(inventors)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(74) Đại diện SHCN": (row) => {
      const reps = row.querySelectorAll(".row");
      if (reps.length) {
        return Array.from(reps)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    // Add more handlers if needed...
  };

  // 2. Field order: must match header
  const FIELD_LABELS = [
    "Loại đơn",
    "Loại đơn PCT",
    "(10) Số bằng và ngày cấp",
    "Trạng thái",
    "(180) Ngày hết hạn",
    "(20) Số đơn và Ngày nộp đơn",
    "(40) Số công bố và ngày công bố",
    "(86) Số đơn và ngày nộp đơn PCT",
    "(87) Số công bố và ngày công bố đơn PCT",
    "(85) Ngày vào pha quốc gia",
    "(30) Chi tiết về dữ liệu ưu tiên",
    "(51) Phân loại IPC",
    "Phân loại CPC",
    "(71/73) Chủ đơn/Chủ bằng",
    "(72) Tác giả sáng chế",
    "(74) Đại diện SHCN",
    "(73) Địa chỉ nhận thư",
    "(54) Tên",
    "(57) Tóm tắt",
    "(58) Các tài liệu đối chứng",
  ];

  // 3. Build label->row map for fast lookup
  const allDetailRows = Array.from(
    doc.querySelectorAll(".product-form-details")
  );
  const labelsByText = {};
  allDetailRows.forEach((row) => {
    const labelEl = row.previousElementSibling;
    if (labelEl && labelEl.classList.contains("product-form-label")) {
      labelsByText[labelEl.textContent.trim()] = row;
    }
  });

  // 4. Collect and order data as per header, using handlers where defined
  let patentData = FIELD_LABELS.map((label) => {
    const row = labelsByText[label];
    if (!row) return ""; // always preserve field order, blanks if missing
    if (PATENT_LABEL_HANDLERS[label]) {
      return PATENT_LABEL_HANDLERS[label](row);
    }
    return row.textContent.trim();
  });

  // 5. Add image URL as second column (after ID)
  let imgURL = "no image";
  let imgTag = doc.querySelector("img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  patentData.unshift(imgURL);

  // 6. Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
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
        .join("<lf>")
    : "no table data";

  // 7. Write header if needed (ID + Image + all fields + Tiến trình)
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      ["ID", "Image", ...FIELD_LABELS, "Tiến trình"].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  // 8. Return the row
  let csvContent = patentData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}
moveOldOutputs(path.join(__dirname, "Results"), 5);
// Enhanced post-check with better error handling and progress tracking
async function postCheckAndRetry(maxRetries = 3) {
  console.log(`\n🔍 Starting post-processing validation...`);
  
  const originalIDs = fs
    .readFileSync(config.path.data, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(utils.isValidID); // Only include valid IDs

  const outputIDs = new Set();

  // Read all existing output files with error handling
  for (const type of Object.keys(outputFiles)) {
    const outputPath = outputFiles[type];
    try {
      if (fs.existsSync(outputPath)) {
        const content = fs.readFileSync(outputPath, "utf-8");
        const lines = content.split("\n").slice(1); // Skip header
        for (const line of lines) {
          const id = line.split("\t")[0]?.trim();
          if (id && utils.isValidID(id)) {
            outputIDs.add(id);
          }
        }
        console.log(`📄 Found ${lines.filter(l => l.trim()).length} records in ${type} output`);
      }
    } catch (error) {
      console.warn(`⚠️ Error reading ${type} output file:`, error.message);
    }
  }

  // Compute missing IDs
  const missingIDs = originalIDs.filter((id) => !outputIDs.has(id));

  if (missingIDs.length === 0) {
    console.log("✅ All IDs successfully processed - no post-check retries needed.");
    return;
  }

  console.log(`🔁 Found ${missingIDs.length} missing IDs, starting targeted retry...`);

  // Retry missing IDs with controlled concurrency
  for (let pass = 1; pass <= maxRetries; pass++) {
    console.log(`\n� Post-check retry pass ${pass}/${maxRetries}`);
    const remaining = [];
    const batchSize = Math.min(config.THREAD_COUNT, missingIDs.length);
    
    // Process in batches to control concurrency
    for (let i = 0; i < missingIDs.length; i += batchSize) {
      const batch = missingIDs.slice(i, i + batchSize);
      const batchPromises = batch.map(async (id) => {
        const url = getUrlById(id);
        
        try {
          await utils.rateLimiter(); // Apply rate limiting
          
          const response = await Promise.race([
            fetch(url),
            utils.createTimeoutPromise(config.timeout.REQUEST_TIMEOUT)
          ]);
          
          if (response.status === 200) {
            const text = await response.text();
            if (!isTextError(text)) {
              // Extract and save data directly without calling extractDataThenContinue
              try {
                // Check if this ID was already processed to prevent duplicates
                if (scrapingState.alreadyScrapedIDs.has(id)) {
                  console.log(`⏭️ Skipping ${id} in post-check - already processed`);
                  scrapingState.markIDAsCompleted(id);
                  return { id, success: true };
                }
                
                const outputData = extractFromHTML(text, id);
                const type = getTypeById(id);
                const formattedData = `${id}\t${outputData}`;
                
                // Add to already scraped set to prevent future duplicates
                scrapingState.alreadyScrapedIDs.add(id);
                
                // Thread-safe file writing
                fs.appendFileSync(outputFiles[type], formattedData);
                
                // Mark as completed in state
                scrapingState.markIDAsCompleted(id);
                
                console.log(`✅ Recovered ID ${id} in post-check`);
                return { id, success: true };
              } catch (extractError) {
                console.warn(`⚠️ Failed to extract data for ${id}: ${extractError.message}`);
              }
            }
          }
        } catch (err) {
          console.warn(`⚠️ Post-check error for ${id}: ${err.message}`);
        }

        return { id, success: false };
      });
      
      const results = await Promise.allSettled(batchPromises);
      results.forEach(result => {
        if (result.status === 'fulfilled' && !result.value.success) {
          remaining.push(result.value.id);
        }
      });
      
      // Small delay between batches
      if (i + batchSize < missingIDs.length) {
        await utils.delay(1000);
      }
    }

    if (remaining.length === 0) {
      console.log("✅ All missing IDs recovered in post-check!");
      return;
    }

    console.log(`⏳ ${remaining.length} IDs still missing after pass ${pass}`);
    missingIDs.length = 0;
    missingIDs.push(...remaining);
    
    // Exponential backoff between retry passes
    if (pass < maxRetries) {
      const delay = Math.min(5000 * Math.pow(2, pass - 1), 30000);
      console.log(`⏸️ Waiting ${delay/1000}s before next retry pass...`);
      await utils.delay(delay);
    }
  }

  // Log final missing IDs
  if (missingIDs.length > 0) {
    // Mark remaining missing IDs as permanently failed
    missingIDs.forEach(id => {
      scrapingState.markIDAsFailedPermanently(id);
      if (!scrapingState.failedQueue.includes(id)) {
        scrapingState.failedQueue.push(id);
      }
    });
    
    const finalFailLogPath = path.join(baseOutputDir, "post_check_failed_ids.txt");
    fs.writeFileSync(finalFailLogPath, missingIDs.join("\n"), "utf-8");
    console.log(`❌ ${missingIDs.length} IDs still missing after all post-check retries`);
    console.log(`📄 Final missing IDs logged to: ${finalFailLogPath}`);
  }
}

// Simple retry loop: just rerun with failed IDs until done
async function simpleRetryLoop() {
  console.log(`\n🔍 Starting simple retry process...`);
  
  let retryAttempt = 1;
  const maxRetryAttempts = 5;
  
  while (retryAttempt <= maxRetryAttempts) {
    // Get list of missing IDs by comparing original list with output
    const originalIDs = fs
      .readFileSync(config.path.data, "utf-8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(utils.isValidID);

    const processedIDs = new Set();

    // Read all existing output files
    for (const type of Object.keys(outputFiles)) {
      const outputPath = outputFiles[type];
      if (fs.existsSync(outputPath)) {
        const content = fs.readFileSync(outputPath, "utf-8");
        const lines = content.split("\n").slice(1); // Skip header
        for (const line of lines) {
          const id = line.split("\t")[0]?.trim();
          if (id && id !== 'No data available after') {
            processedIDs.add(id);
          }
        }
      }
    }

    const missingIDs = originalIDs.filter(id => !processedIDs.has(id));
    
    if (missingIDs.length === 0) {
      console.log(`🎉 All IDs processed successfully!`);
      break;
    }
    
    console.log(`\n🔄 Retry attempt ${retryAttempt}/${maxRetryAttempts}`);
    console.log(`📋 Found ${missingIDs.length} missing IDs, reprocessing with normal script...`);
    
    // Update IDs array with missing IDs for retry
    IDs = missingIDs;
    scrapingState.totalIDsToProcess = missingIDs.length;
    
    // Reset state for retry
    scrapingState.completedIDs.clear();
    scrapingState.permanentlyFailedIDs.clear();
    scrapingState.processingIDs.clear();
    scrapingState.retryTracker.clear();
    scrapingState.activeThreads = config.THREAD_COUNT;
    
    // Rerun the main processing function
    await start();
    
    retryAttempt++;
    
    // Small delay between retry attempts (only if there are still missing IDs)
    const updatedProcessedIDs = new Set();
    for (const type of Object.keys(outputFiles)) {
      const outputPath = outputFiles[type];
      if (fs.existsSync(outputPath)) {
        const content = fs.readFileSync(outputPath, "utf-8");
        const lines = content.split("\n").slice(1);
        for (const line of lines) {
          const id = line.split("\t")[0]?.trim();
          if (id && id !== 'No data available after') {
            updatedProcessedIDs.add(id);
          }
        }
      }
    }
    
    const stillMissing = originalIDs.filter(id => !updatedProcessedIDs.has(id));
    if (retryAttempt <= maxRetryAttempts && stillMissing.length > 0) {
      console.log(`⏸️ Waiting 10 seconds before next retry attempt...`);
      await utils.delay(10000);
    }
  }
  
  // Final check and report
  const finalOriginalIDs = fs
    .readFileSync(config.path.data, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(utils.isValidID);

  const finalProcessedIDs = new Set();
  for (const type of Object.keys(outputFiles)) {
    const outputPath = outputFiles[type];
    if (fs.existsSync(outputPath)) {
      const content = fs.readFileSync(outputPath, "utf-8");
      const lines = content.split("\n").slice(1);
      for (const line of lines) {
        const id = line.split("\t")[0]?.trim();
        if (id && id !== 'No data available after') {
          finalProcessedIDs.add(id);
        }
      }
    }
  }
  
  const finalMissingIDs = finalOriginalIDs.filter(id => !finalProcessedIDs.has(id));
  if (finalMissingIDs.length > 0) {
    const failedIdsPath = path.join(baseOutputDir, "final_failed_ids.txt");
    fs.writeFileSync(failedIdsPath, finalMissingIDs.join("\n"), "utf-8");
    console.log(`❌ ${finalMissingIDs.length} IDs could not be processed after all attempts`);
    console.log(`📄 Failed IDs saved to: ${failedIdsPath}`);
    
    // Mark as permanently failed
    finalMissingIDs.forEach(id => {
      scrapingState.markIDAsFailedPermanently(id);
    });
  }
}

// Enhanced main function with comprehensive error handling
async function main() {
  try {
    console.log(`🏁 Starting WIPO scraping application...`);
    console.log(`📅 Started at: ${new Date().toLocaleString("vi-VN")}`);
    console.log(`📁 Output directory: ${baseOutputDir}\n`);
    
    // Validate input file
    if (!fs.existsSync(config.path.data)) {
      throw new Error(`Input file not found: ${config.path.data}`);
    }
    
    // Validate IDs
    const validIDs = IDs.filter(utils.isValidID);
    const invalidIDs = IDs.filter(id => !utils.isValidID(id));
    
    if (invalidIDs.length > 0) {
      console.warn(`⚠️ Found ${invalidIDs.length} invalid IDs, skipping them`);
      IDs = validIDs;
    }
    
    if (IDs.length === 0) {
      console.log(`✅ All IDs have already been scraped! No new processing needed.`);
      console.log(`📊 Total IDs in file: ${allIDs.length}`);
      console.log(`🎯 Already scraped: ${scrapingState.alreadyScrapedIDs.size}`);
      console.log(`📁 Check output files in: ${baseOutputDir}`);
      return;
    }
    
    config.TOTAL_REQUEST = IDs.length;
    console.log(`📋 Processing ${IDs.length} valid IDs\n`);
    
    // Start main processing
    await start();
    
    // Simple retry loop instead of complex post-processing
    await simpleRetryLoop();
    
    // Generate final comprehensive report
    generateFinalReport();
    
    console.log(`🎉 Application completed successfully!`);
    console.log(`📅 Finished at: ${new Date().toLocaleString("vi-VN")}`);
    
  } catch (error) {
    console.error(`💥 Fatal error:`, error.message);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n⏹️ Graceful shutdown initiated...');
  console.log(`📊 Progress at shutdown: ${scrapingState.completedIDs.size}/${config.TOTAL_REQUEST} completed`);
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main();
