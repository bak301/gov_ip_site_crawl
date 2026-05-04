const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

class WipoTrademarkScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.outputData = [];
        this.mode = null; // Will be set by user selection
        this.baseOutputDir = this.createOutputDirectory();
        
        // Cache for duplicate detection
        this.resultCache = []; // Store last 500 results for comparison
        this.maxCacheSize = 500;
        this.duplicateCount = 0;
        this.maxDuplicatePages = 3; // Stop if we find 3 consecutive pages with all duplicates
        
        // Get today's date properly
        const today = new Date();
        this.todayDate = today.getFullYear() + '-' + 
                        String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                        String(today.getDate()).padStart(2, '0');
        
        // Configuration for different modes
        this.modeConfig = {
            1: {
                name: 'Trademarks',
                url: 'https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/trademarks?1&query=OFCO:VN#',
                fileName: 'NH_Trademarks',
                rowSelector: 'tr.odd, tr.even'
            },
            2: {
                name: 'Patents',
                url: 'https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/patents?query=*:*',
                fileName: 'SC_Patents',
                rowSelector: 'tr.odd, tr.even'
            },
            3: {
                name: 'Designs',
                url: 'https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/designs?3&query=OFCO:VN',
                fileName: 'KD_Designs',
                rowSelector: 'tr.odd, tr.even'
            }
        };
        
        this.outputFile = null; // Will be set after mode selection
        this.globalTrackingFile = path.join(__dirname, "WIPO_NextPage_Global_Tracking.txt");
    }

    createOutputDirectory() {
        // Force use today's date - you can manually set this if needed
        const today = new Date();
        const todayDate = today.getFullYear() + '-' + 
                         String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                         String(today.getDate()).padStart(2, '0');
        
        console.log(`📅 Using date: ${todayDate}`);
        const baseOutputDir = path.join(__dirname, 'Output', todayDate);
        if (!fs.existsSync(baseOutputDir)) {
            fs.mkdirSync(baseOutputDir, { recursive: true });
            console.log(`📁 Created output directory: ${baseOutputDir}`);
        }
        return baseOutputDir;
    }

    async selectMode() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            console.log('\n=== WIPO SCRAPER MODE SELECTION ===');
            console.log('Please select the type of intellectual property to scrape:');
            console.log('1. Trademarks (Nhãn hiệu)');
            console.log('2. Patents (Sáng chế)');
            console.log('3. Designs (Kiểu dáng công nghiệp)');
            console.log('=====================================');
            
            rl.question('Enter your choice (1, 2, or 3): ', (answer) => {
                const choice = parseInt(answer.trim());
                
                if (choice >= 1 && choice <= 3) {
                    this.mode = choice;
                    const config = this.modeConfig[choice];
                    this.outputFile = path.join(this.baseOutputDir, `${config.fileName}_${this.todayDate}.txt`);
                    
                    console.log(`\n✅ Selected mode: ${config.name}`);
                    console.log(`📄 Output file: ${this.outputFile}`);
                    console.log(`🔗 Target URL: ${config.url}\n`);
                    
                    rl.close();
                    resolve();
                } else {
                    console.log('❌ Invalid choice. Please enter 1, 2, or 3.');
                    rl.close();
                    this.selectMode().then(resolve); // Recursive call for invalid input
                }
            });
        });
    }

    async waitForUserInput() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            const config = this.modeConfig[this.mode];
            console.log('\n=== MANUAL SETUP PHASE ===');
            console.log(`Current mode: ${config.name}`);
            console.log('The browser window is now open. Please:');
            console.log('1. Set up your search filters and criteria');
            console.log('2. Navigate to the search results page');
            console.log('3. Switch to list view manually');
            console.log('4. Configure pagination/view settings as needed');
            console.log('5. Make any other adjustments you want');
            console.log(`\n⚠️  Make sure you are on the page with ${config.name.toLowerCase()} list data before proceeding!`);
            console.log('\nWhen you are ready to start scraping the current page, press ENTER in this terminal...');
            
            rl.question('Press ENTER to start scraping: ', () => {
                console.log('\n🚀 Starting automatic scraping process...\n');
                rl.close();
                resolve();
            });
        });
    }

    async pauseForManualFix(errorMessage = '') {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            console.log('\n⚠️ === MANUAL INTERVENTION REQUIRED ===');
            console.log('🛑 The scraper encountered an issue and needs manual assistance.');
            if (errorMessage) {
                console.log(`❌ Error: ${errorMessage}`);
            }
            console.log('\nPlease:');
            console.log('1. Check the browser window for any issues');
            console.log('2. Fix any pagination or loading problems manually');
            console.log('3. Navigate to the next page if needed');
            console.log('4. Ensure the page is fully loaded');
            console.log('\n✅ When ready to continue, press ENTER...');
            
            rl.question('', () => {
                console.log('🔄 Resuming automatic scraping...\n');
                rl.close();
                resolve();
            });
        });
    }

    // Cache management methods
    addToCache(results) {
        // Add new results to cache
        this.resultCache.push(...results);
        
        // Keep only the last 500 results
        if (this.resultCache.length > this.maxCacheSize) {
            this.resultCache = this.resultCache.slice(-this.maxCacheSize);
        }
    }

    createResultSignature(result) {
        // Create a unique signature for a result based on key fields
        // Using first 3 fields (ID, title/name, and original app number) for comparison
        return result.slice(0, 3).join('|').toLowerCase().trim();
    }

    checkForDuplicates(newResults) {
        if (this.resultCache.length === 0) {
            return { 
                duplicates: 0, 
                newCount: newResults.length,
                uniqueResults: newResults // Fix: return all results as unique when cache is empty
            };
        }

        const cacheSignatures = new Set(
            this.resultCache.map(result => this.createResultSignature(result))
        );

        let duplicateCount = 0;
        const uniqueNewResults = [];

        newResults.forEach(result => {
            const signature = this.createResultSignature(result);
            if (cacheSignatures.has(signature)) {
                duplicateCount++;
                console.log(`🔄 Duplicate found: ${result[0]} - ${result[1] || 'N/A'}`);
            } else {
                uniqueNewResults.push(result);
            }
        });

        return {
            duplicates: duplicateCount,
            newCount: uniqueNewResults.length,
            uniqueResults: uniqueNewResults
        };
    }

    async getPaginationInfo() {
        try {
            return await this.page.evaluate(() => {
                // Try multiple selectors for the pagination info
                const selectors = [
                    'ul.paginator.search-result-display li.navigatorLabel.results-display-text div',
                    'ul.paginator li.navigatorLabel div',
                    '.results-display-text div',
                    '.navigatorLabel div',
                    'ul.paginator li div'
                ];
                
                let paginatorElement = null;
                let text = '';
                
                for (const selector of selectors) {
                    paginatorElement = document.querySelector(selector);
                    if (paginatorElement) {
                        text = paginatorElement.textContent.trim();
                        if (text.includes('Showing') && text.includes('of') && text.includes('results')) {
                            break;
                        }
                    }
                }
                
                if (!text) {
                    // Fallback: try to find any element containing pagination text
                    const allDivs = document.querySelectorAll('div');
                    for (const div of allDivs) {
                        const divText = div.textContent.trim();
                        if (divText.match(/Showing \d+ - \d+ of \d+ results/)) {
                            text = divText;
                            break;
                        }
                    }
                }
                
                if (text) {
                    // Parse "Showing 1 - 50 of 895945 results" or similar patterns
                    const match = text.match(/Showing (\d+) - (\d+) of (\d+) results/);
                    if (match) {
                        return {
                            text: text,
                            start: parseInt(match[1]),
                            end: parseInt(match[2]),
                            total: parseInt(match[3]),
                            currentRange: `${match[1]}-${match[2]}`,
                            found: true,
                            selector: 'Found via pagination text'
                        };
                    }
                }
                
                return { 
                    text: text || 'No pagination text found', 
                    start: 0, 
                    end: 0, 
                    total: 0, 
                    currentRange: '', 
                    found: false,
                    selector: 'None'
                };
            });
        } catch (error) {
            console.log(`⚠️ Error getting pagination info: ${error.message}`);
            return { 
                text: `Error: ${error.message}`, 
                start: 0, 
                end: 0, 
                total: 0, 
                currentRange: '', 
                found: false,
                selector: 'Error'
            };
        }
    }

    async waitForPageChange(previousPageInfo) {
        let retryCount = 0;
        const maxRetries = 60; // 60 attempts x 5 seconds = 300 seconds (5 minutes)
        const retryDelay = 5000; // 5 seconds between checks

        console.log(`⏳ Previous page range: ${previousPageInfo.currentRange}`);

        while (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            try {
                // First check if we can still find the next button
                const nextButtonExists = await this.page.evaluate(() => {
                    const nextSelectors = [
                        'a[title="Go to next page"]:not(.disabled)',
                        '.pagination .next:not(.disabled)',
                        '.pagination a[title*="next"]:not(.disabled)',
                        '.pagination a[aria-label*="Next"]:not(.disabled)',
                        'a[href*="navigation-next"]:not(.disabled)'
                    ];
                    
                    for (const selector of nextSelectors) {
                        const button = document.querySelector(selector);
                        if (button && !button.classList.contains('disabled') && 
                            !button.hasAttribute('disabled')) {
                            return true;
                        }
                    }
                    return false;
                });

                if (!nextButtonExists) {
                    console.log(`🏁 Next button is disabled or missing - reached end of pagination`);
                    return null;
                }
                
                // Get current pagination info
                const currentPageInfo = await this.getPaginationInfo();
                
                // Also get a content signature as backup verification
                const currentContentSignature = await this.getPageContentSignature();
                
                console.log(`🔍 Attempt ${retryCount + 1}: Range=${currentPageInfo.currentRange}, Found=${currentPageInfo.found}`);
                console.log(`🔍 Content signature: ${currentContentSignature.substring(0, 30)}...`);
                
                // Check if pagination info changed
                if (currentPageInfo.found && currentPageInfo.currentRange !== previousPageInfo.currentRange) {
                    console.log(`✅ Page changed via pagination: ${previousPageInfo.currentRange} → ${currentPageInfo.currentRange}`);
                    console.log(`📊 Current pagination: ${currentPageInfo.text}`);
                    return currentPageInfo;
                }
                
                // Fallback: if pagination info isn't found but content signature changed significantly
                if (!currentPageInfo.found) {
                    console.log(`⚠️ Pagination info not found, checking content changes instead`);
                    console.log(`📄 Pagination text found: "${currentPageInfo.text}"`);
                    
                    // Try to extract range from first and last visible row IDs as fallback
                    const rowBasedInfo = await this.getRowBasedPageInfo();
                    if (rowBasedInfo.found && rowBasedInfo.signature !== (previousPageInfo.signature || '')) {
                        console.log(`✅ Page changed via row content: Different data detected`);
                        console.log(`🔢 Row-based info: ${rowBasedInfo.firstId} to ${rowBasedInfo.lastId}`);
                        return { ...currentPageInfo, ...rowBasedInfo, found: true };
                    }
                }

                retryCount++;
                console.log(`⏳ Waiting for page change... attempt ${retryCount}/${maxRetries} (${retryCount * 5}s elapsed, max wait: 300s)`);
                
            } catch (error) {
                console.log(`⚠️ Error checking page content: ${error.message}`);
                retryCount++;
            }
        }

        console.log(`⚠️ Page range did not change after ${maxRetries} attempts (300 seconds)`);
        console.log(`🛑 Pausing for manual intervention...`);
        
        // Pause for user input instead of returning null
        await this.pauseForManualFix('Pagination did not load within 300 seconds');
        
        // After user confirms, check the page again
        console.log('🔄 Checking page status after manual intervention...');
        const currentPageInfo = await this.getPaginationInfo();
        
        if (currentPageInfo.found && currentPageInfo.currentRange !== previousPageInfo.currentRange) {
            console.log(`✅ Page changed after manual intervention: ${previousPageInfo.currentRange} → ${currentPageInfo.currentRange}`);
            return currentPageInfo;
        }
        
        // If still no change, ask user what to do
        const rl = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        return new Promise((resolve) => {
            console.log('\n⚠️ Page still appears unchanged.');
            console.log('Options:');
            console.log('1. Press ENTER to continue anyway (will retry)');
            console.log('2. Press Ctrl+C to stop the scraper');
            
            rl.question('\nPress ENTER to continue: ', () => {
                console.log('🔄 Continuing...\n');
                rl.close();
                // Return the current info even if unchanged
                resolve(currentPageInfo.found ? currentPageInfo : null);
            });
        });
    }

    async getRowBasedPageInfo() {
        try {
            return await this.page.evaluate((selector) => {
                const rows = document.querySelectorAll(selector);
                if (rows.length === 0) {
                    return { found: false, signature: '', firstId: '', lastId: '', count: 0 };
                }
                
                // Get first and last row IDs
                const firstRow = rows[0];
                const lastRow = rows[rows.length - 1];
                
                const firstId = firstRow.id || firstRow.querySelector('input[type="checkbox"]')?.value || '';
                const lastId = lastRow.id || lastRow.querySelector('input[type="checkbox"]')?.value || '';
                
                // Create a signature from all row IDs
                let signature = '';
                for (let i = 0; i < Math.min(10, rows.length); i++) {
                    const row = rows[i];
                    const id = row.id || row.querySelector('input[type="checkbox"]')?.value || '';
                    signature += id + '|';
                }
                
                return {
                    found: true,
                    signature: signature,
                    firstId: firstId,
                    lastId: lastId,
                    count: rows.length,
                    currentRange: `${firstId}-${lastId}`
                };
            }, this.modeConfig[this.mode].rowSelector);
        } catch (error) {
            console.log(`⚠️ Error getting row-based info: ${error.message}`);
            return { found: false, signature: '', firstId: '', lastId: '', count: 0 };
        }
    }

    async getPageContentSignature() {
        try {
            return await this.page.evaluate((selector) => {
                const rows = document.querySelectorAll(selector);
                if (rows.length === 0) return '';
                
                // Create a signature from first few rows
                let signature = '';
                for (let i = 0; i < Math.min(5, rows.length); i++) {
                    const row = rows[i];
                    const id = row.id || '';
                    const firstCell = row.querySelector('td') ? row.querySelector('td').textContent.trim() : '';
                    signature += id + '|' + firstCell + '||';
                }
                return signature;
            }, this.modeConfig[this.mode].rowSelector);
        } catch (error) {
            console.log(`⚠️ Error getting page signature: ${error.message}`);
            return '';
        }
    }

    async init() {
        console.log('Initializing Puppeteer browser...');
        this.browser = await puppeteer.launch({
            headless: false, // Start with GUI for manual setup
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        this.page = await this.browser.newPage();
        
        // Block images and other resources to reduce overhead
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            const resourceType = req.resourceType();
            // Block images, fonts, and other unnecessary resources
            if(resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        // Set user agent to avoid blocking
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Set viewport
        await this.page.setViewport({ width: 1920, height: 1080 });
    }

    async switchToHeadlessMode() {
        console.log('🔄 Switching to headless mode for optimal performance...');
        
        // Get the current page URL to preserve state
        const currentUrl = this.page.url();
        
        // Close the current browser
        await this.browser.close();
        
        // Launch new headless browser
        this.browser = await puppeteer.launch({
            headless: true, // Now in headless mode
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        this.page = await this.browser.newPage();
        
        // Re-apply request interception for blocking images
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
            const resourceType = req.resourceType();
            if(resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        // Set user agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Set viewport
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate back to the current URL to preserve state
        await this.page.goto(currentUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });
        
        console.log('✅ Successfully switched to headless mode');
    }

    async navigateToPage() {
        const config = this.modeConfig[this.mode];
        console.log(`Navigating to ${config.name} search page...`);
        const url = config.url;
        
        try {
            console.log('Loading page...');
            await this.page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 60000 
            });
            
            // Wait a bit for any dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 5000));
            console.log('Page loaded successfully');
            
            // Check if we can find any content
            const pageTitle = await this.page.title();
            console.log('Page title:', pageTitle);
            
        } catch (error) {
            console.error('Error navigating to page:', error);
            console.log('Attempting to continue anyway...');
        }
    }

    async extractTrademarkData(currentPage = 1) {
        const config = this.modeConfig[this.mode];
        
        try {
            // Wait for content to load based on mode
            await this.page.waitForSelector(config.rowSelector, { timeout: 10000 });
            
            const extractedData = await this.page.evaluate((mode, rowSelector) => {
                const rows = document.querySelectorAll(rowSelector);
                const extractedData = [];
                
                if (mode === 1) {
                    // Trademarks extraction
                    rows.forEach((row, index) => {
                        try {
                            const id = row.id;
                            if (!id) return;
                            
                            const data = [];
                            data.push(id); // ID
                            
                            // Nhãn hiệu
                            const trademarkName = row.querySelector('.rs-MK');
                            data.push(trademarkName ? trademarkName.textContent.trim() : '');
                            
                            // Số đơn gốc
                            const originalAppNum = row.querySelector('.rs-AFNB_ORI');
                            data.push(originalAppNum ? originalAppNum.textContent.trim() : '');
                            
                            // Ngày nộp đơn
                            const appDate = row.querySelector('.rs-AFDT');
                            data.push(appDate ? appDate.textContent.trim() : '');
                            
                            // Số công bố
                            const pubNum = row.querySelector('.rs-GZNB, .rs-PBNB');
                            data.push(pubNum ? pubNum.textContent.trim() : '');
                            
                            // Ngày công bố
                            const pubDate = row.querySelector('.rs-PBDT');
                            data.push(pubDate ? pubDate.textContent.trim() : '');
                            
                            // Số bằng
                            const certNum = row.querySelector('.rs-RENB');
                            data.push(certNum ? certNum.textContent.trim() : '');
                            
                            // Ngày cấp
                            const issueDate = row.querySelector('.rs-REDT');
                            data.push(issueDate ? issueDate.textContent.trim() : '');
                            
                            // Nhóm sản phẩm/dịch vụ
                            const productGroup = row.querySelector('.rs-NCL');
                            data.push(productGroup ? productGroup.textContent.trim() : '');
                            
                            // Phân loại Viên
                            const viennaClass = row.querySelector('.rs-VCL');
                            data.push(viennaClass ? viennaClass.textContent.trim() : '');
                            
                            // Chủ đơn/Chủ bằng
                            const applicant = row.querySelector('.rs-APNA');
                            data.push(applicant ? applicant.textContent.trim() : '');
                            
                            // Trạng thái
                            const status = row.querySelector('.rs-STLB');
                            data.push(status ? status.textContent.trim() : '');
                            
                            extractedData.push(data);
                        } catch (error) {
                            console.error('Error extracting data from trademark row:', error);
                        }
                    });
                } else if (mode === 2) {
                    // Patents extraction (similar to trademarks, adjust selectors as needed)
                    rows.forEach((row, index) => {
                        try {
                            const id = row.id;
                            if (!id) return;
                            
                            const data = [];
                            data.push(id); // ID
                            
                            // Add patent-specific fields here
                            // For now, using similar structure to trademarks
                            const title = row.querySelector('.rs-TITL, .rs-MK');
                            data.push(title ? title.textContent.trim() : '');
                            
                            const originalAppNum = row.querySelector('.rs-AFNB_ORI');
                            data.push(originalAppNum ? originalAppNum.textContent.trim() : '');
                            
                            const appDate = row.querySelector('.rs-AFDT');
                            data.push(appDate ? appDate.textContent.trim() : '');
                            
                            const pubNum = row.querySelector('.rs-GZNB, .rs-PBNB');
                            data.push(pubNum ? pubNum.textContent.trim() : '');
                            
                            const pubDate = row.querySelector('.rs-PBDT');
                            data.push(pubDate ? pubDate.textContent.trim() : '');
                            
                            const certNum = row.querySelector('.rs-RENB');
                            data.push(certNum ? certNum.textContent.trim() : '');
                            
                            const issueDate = row.querySelector('.rs-REDT');
                            data.push(issueDate ? issueDate.textContent.trim() : '');
                            
                            const ipcClass = row.querySelector('.rs-ICL');
                            data.push(ipcClass ? ipcClass.textContent.trim() : '');
                            
                            const applicant = row.querySelector('.rs-APNA');
                            data.push(applicant ? applicant.textContent.trim() : '');
                            
                            const inventor = row.querySelector('.rs-INNA');
                            data.push(inventor ? inventor.textContent.trim() : '');
                            
                            const status = row.querySelector('.rs-STLB');
                            data.push(status ? status.textContent.trim() : '');
                            
                            extractedData.push(data);
                        } catch (error) {
                            console.error('Error extracting data from patent row:', error);
                        }
                    });
                } else if (mode === 3) {
                    // Designs extraction
                    rows.forEach((row, index) => {
                        try {
                            // Extract ID from checkbox value or input field
                            const checkbox = row.querySelector('input[type="checkbox"]');
                            const id = checkbox ? checkbox.value : '';
                            if (!id) return;
                            
                            const data = [];
                            data.push(id); // ID
                            
                            // Trạng thái
                            const status = row.querySelector('.rs-STLB');
                            data.push(status ? status.textContent.trim() : '');
                            
                            // Tên
                            const title = row.querySelector('.rs-TITL');
                            data.push(title ? title.textContent.trim() : '');
                            
                            // Số đơn gốc
                            const originalAppNum = row.querySelector('.rs-AFNB_ORI');
                            data.push(originalAppNum ? originalAppNum.textContent.trim() : '');
                            
                            // Ngày nộp đơn
                            const appDate = row.querySelector('.rs-AFDT');
                            data.push(appDate ? appDate.textContent.trim() : '');
                            
                            // Số công bố
                            const pubNum = row.querySelector('.rs-PBNB');
                            data.push(pubNum ? pubNum.textContent.trim() : '');
                            
                            // Ngày công bố
                            const pubDate = row.querySelector('.rs-PBDT');
                            data.push(pubDate ? pubDate.textContent.trim() : '');
                            
                            // Mã Nước của đơn ưu tiên
                            const priorityCountry = row.querySelector('.rs-PCCT');
                            data.push(priorityCountry ? priorityCountry.textContent.trim() : '');
                            
                            // Số đơn ưu tiên
                            const priorityNum = row.querySelector('.rs-PCNB');
                            data.push(priorityNum ? priorityNum.textContent.trim() : '');
                            
                            // Ngày đơn ưu tiên
                            const priorityDate = row.querySelector('.rs-PCDT');
                            data.push(priorityDate ? priorityDate.textContent.trim() : '');
                            
                            // Phân loại Locarno
                            const locarnoClass = row.querySelector('.rs-LCL');
                            data.push(locarnoClass ? locarnoClass.textContent.trim() : '');
                            
                            // Số bằng
                            const certNum = row.querySelector('.rs-RENB');
                            data.push(certNum ? certNum.textContent.trim() : '');
                            
                            // Ngày cấp
                            const issueDate = row.querySelector('.rs-REDT');
                            data.push(issueDate ? issueDate.textContent.trim() : '');
                            
                            // Chủ đơn/Chủ bằng
                            const applicant = row.querySelector('.rs-APNA');
                            data.push(applicant ? applicant.textContent.trim() : '');
                            
                            // Tác giả kiểu dáng
                            const designer = row.querySelector('.rs-DENA');
                            data.push(designer ? designer.textContent.trim() : '');
                            
                            extractedData.push(data);
                        } catch (error) {
                            console.error('Error extracting data from design row:', error);
                        }
                    });
                }
                
                return extractedData;
            }, this.mode, config.rowSelector);
            
            // Add to total count for tracking
            this.outputData = this.outputData.concat(extractedData);
            
            // Simple colorized single-line log
            console.log(`\x1b[36mPage ${currentPage}:\x1b[0m \x1b[32m${extractedData.length} records\x1b[0m | \x1b[33mTotal: ${this.outputData.length}\x1b[0m`);
            
            return extractedData;
            
        } catch (error) {
            console.error(`Error extracting ${config.name.toLowerCase()} data:`, error);
            throw error;
        }
    }

    async handlePagination() {
        console.log('\n🔄 Starting pagination handling...');
        
        let currentPage = 1;
        let hasNextPage = true;
        let consecutiveDuplicatePages = 0;
        const config = this.modeConfig[this.mode];
        
        // Timing variables
        const paginationStartTime = Date.now();
        let pageStartTime = Date.now(); // Start timing from first page
        const pageTimes = [];
        let totalResults = 0;
        let processedRecords = 0;
        
        try {
            while (hasNextPage) {
                // Timestamp for display only (not used for timing)
                const timestamp = new Date().toLocaleString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                
                console.log(`\n📄 Processing page ${currentPage}... [${timestamp}]`);
                
                // Get current pagination info with detailed debugging
                const pageInfo = await this.getPaginationInfo();
                console.log(`🔍 Debug - Pagination found: ${pageInfo.found}`);
                console.log(`🔍 Debug - Pagination text: "${pageInfo.text}"`);
                console.log(`🔍 Debug - Selector used: ${pageInfo.selector}`);
                
                if (pageInfo.found) {
                    console.log(`📊 Pagination: ${pageInfo.text}`);
                    console.log(`🔍 Current range: ${pageInfo.currentRange} (${pageInfo.end - pageInfo.start + 1} records expected)`);
                    
                    // Extract total results from pagination text
                    const totalMatch = pageInfo.text.match(/of\s+([\d,]+)\s+results?/i);
                    if (totalMatch) {
                        totalResults = parseInt(totalMatch[1].replace(/,/g, ''));
                    }
                } else {
                    console.log('⚠️ Could not find pagination info, using fallback methods');
                    
                    // Get row-based info as fallback
                    const rowInfo = await this.getRowBasedPageInfo();
                    if (rowInfo.found) {
                        console.log(`🔢 Row-based fallback: ${rowInfo.count} rows, IDs ${rowInfo.firstId} to ${rowInfo.lastId}`);
                        pageInfo.signature = rowInfo.signature; // Store for comparison
                    }
                }
                
                // Extract data from current page
                const pageData = await this.extractTrademarkData(currentPage);
                
                if (pageData.length === 0) {
                    console.log('⚠️ No data found on this page, stopping pagination');
                    break;
                }

                console.log(`📝 Page ${currentPage}: ${pageData.length} records extracted`);
                
                // Check if actual extracted count matches expected count
                if (pageInfo.found) {
                    const expectedCount = pageInfo.end - pageInfo.start + 1;
                    if (pageData.length !== expectedCount) {
                        console.log(`⚠️ Mismatch: Expected ${expectedCount} records, got ${pageData.length}`);
                    }
                }

                // Check for duplicates against cache
                const duplicateCheck = this.checkForDuplicates(pageData);
                console.log(`📊 Page ${currentPage}: ${duplicateCheck.newCount} new, ${duplicateCheck.duplicates} duplicates`);
                
                // Update processed records count (do this before timing display)
                if (pageInfo.found) {
                    processedRecords = pageInfo.end;
                } else {
                    processedRecords += pageData.length;
                }

                // If all results are duplicates, increment consecutive duplicate counter
                if (duplicateCheck.duplicates === pageData.length) {
                    consecutiveDuplicatePages++;
                    console.log(`⚠️ All results on page ${currentPage} are duplicates (${consecutiveDuplicatePages}/${this.maxDuplicatePages})`);
                    
                    if (consecutiveDuplicatePages >= this.maxDuplicatePages) {
                        console.log(`🛑 Found ${this.maxDuplicatePages} consecutive pages with all duplicates. Stopping pagination.`);
                        break;
                    }
                } else {
                    // Reset counter if we found new data
                    consecutiveDuplicatePages = 0;
                    
                    // Add only unique results to output and cache
                    this.outputData.push(...duplicateCheck.uniqueResults);
                    this.addToCache(duplicateCheck.uniqueResults);
                    
                    // Save page data immediately
                    await this.savePageData(duplicateCheck.uniqueResults);
                    console.log(`💾 Saved ${duplicateCheck.uniqueResults.length} new records to file`);
                }

                // Calculate and display timing information AFTER all processing is done
                // This captures the full page cycle time including extraction, dedup, and saving
                const pageEndTime = Date.now();
                const pageTime = (pageEndTime - pageStartTime) / 1000; // in seconds
                pageTimes.push(pageTime);
                
                // Calculate average time per page
                const avgTimePerPage = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
                
                // Calculate ETA - SIMPLE: total records / 60 records per page
                let etaText = 'N/A';
                let estimatedTotalPages = 0;
                let remainingPages = 0;
                
                if (totalResults > 0) {
                    estimatedTotalPages = Math.ceil(totalResults / 60); // 60 records per page (fixed)
                    remainingPages = estimatedTotalPages - currentPage;
                    const etaSeconds = remainingPages * avgTimePerPage;
                    
                    const hours = Math.floor(etaSeconds / 3600);
                    const minutes = Math.floor((etaSeconds % 3600) / 60);
                    const seconds = Math.floor(etaSeconds % 60);
                    
                    if (hours > 0) {
                        etaText = `${hours}h ${minutes}m ${seconds}s`;
                    } else if (minutes > 0) {
                        etaText = `${minutes}m ${seconds}s`;
                    } else {
                        etaText = `${seconds}s`;
                    }
                    
                    console.log(`⏱️  Page time: ${pageTime.toFixed(2)}s | Avg: ${avgTimePerPage.toFixed(2)}s/page`);
                    console.log(`📊 Progress: ${processedRecords}/${totalResults} (${((processedRecords/totalResults)*100).toFixed(2)}%) | Page: ${currentPage}/${estimatedTotalPages} | Remaining: ${remainingPages} pages`);
                    console.log(`⏰ ETA: ${etaText}`);
                } else {
                    console.log(`⏱️  Page time: ${pageTime.toFixed(2)}s | Avg: ${avgTimePerPage.toFixed(2)}s/page`);
                }

                // Check if next page button exists and is enabled
                const nextPageInfo = await this.page.evaluate(() => {
                    const nextSelectors = [
                        'a[title="Go to next page"]',
                        '.pagination .next:not(.disabled)',
                        '.pagination a[title*="next"]',
                        '.pagination a[aria-label*="Next"]',
                        'a[href*="navigation-next"]'
                    ];
                    
                    for (const selector of nextSelectors) {
                        const nextButton = document.querySelector(selector);
                        if (nextButton && !nextButton.classList.contains('disabled')) {
                            return {
                                exists: true,
                                href: nextButton.href,
                                text: nextButton.textContent.trim()
                            };
                        }
                    }
                    
                    return { exists: false };
                });
                
                if (nextPageInfo.exists) {
                    console.log(`🔗 Next page available: ${nextPageInfo.text}`);
                    
                    // Click the next page button
                    const clickResult = await this.page.evaluate(() => {
                        const nextSelectors = [
                            'a[title="Go to next page"]',
                            '.pagination .next:not(.disabled)',
                            '.pagination a[title*="next"]',
                            '.pagination a[aria-label*="Next"]',
                            'a[href*="navigation-next"]'
                        ];
                        
                        for (const selector of nextSelectors) {
                            const nextButton = document.querySelector(selector);
                            if (nextButton && !nextButton.classList.contains('disabled') && 
                                !nextButton.hasAttribute('disabled')) {
                                nextButton.click();
                                return { clicked: true, selector: selector };
                            }
                        }
                        return { clicked: false, selector: 'none' };
                    });
                    
                    if (!clickResult.clicked) {
                        console.log('❌ Could not click next page button - it may have become disabled');
                        break;
                    }
                    
                    console.log(`✅ Clicked next page button using selector: ${clickResult.selector}`);
                    
                    // Wait for page pagination info to actually change
                    console.log('⏳ Waiting for new page to load...');
                    const newPageInfo = await this.waitForPageChange(pageInfo);
                    
                    if (!newPageInfo) {
                        console.log('⚠️ Pagination issue detected after user intervention');
                        console.log('🔄 Will pause for user to fix the issue...');
                        
                        // Pause for manual intervention
                        await this.pauseForManualFix('Unable to detect page change - please check pagination manually');
                        
                        // After user fixes, try to continue
                        console.log('✅ Resuming pagination...');
                        currentPage++;
                        continue; // Continue to next iteration
                    }
                    
                    // Check for data gaps
                    if (pageInfo.found && newPageInfo.found) {
                        const expectedNext = pageInfo.end + 1;
                        if (newPageInfo.start !== expectedNext) {
                            console.log(`⚠️ Data gap detected! Expected next start: ${expectedNext}, actual: ${newPageInfo.start}`);
                            console.log(`🔢 Gap size: ${newPageInfo.start - expectedNext} records`);
                        }
                    }
                    
                    // Wait for rows to appear on new page
                    try {
                        await this.page.waitForSelector(config.rowSelector, { timeout: 15000 });
                        console.log('✅ New page content loaded successfully');
                        
                        // Reset page start time for the next page cycle
                        pageStartTime = Date.now();
                    } catch (waitError) {
                        console.log('⚠️ Timeout waiting for content on next page');
                        // Pause for user intervention instead of breaking
                        await this.pauseForManualFix('Timeout waiting for content - please check if page loaded correctly');
                        console.log('✅ Continuing after manual check...');
                        
                        // Reset page start time after manual intervention
                        pageStartTime = Date.now();
                    }
                    
                    currentPage++;
                } else {
                    console.log('🏁 No more pages found - next page button not available or disabled');
                    console.log('⚠️ Pausing to confirm if this is the end...');
                    
                    // Pause for user to confirm
                    const rl = require('readline').createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    
                    const shouldContinue = await new Promise((resolve) => {
                        console.log('\nOptions:');
                        console.log('1. Press ENTER if pagination is complete (will stop scraping)');
                        console.log('2. Fix the issue manually and press ENTER to continue scraping');
                        console.log('3. Press Ctrl+C to stop immediately');
                        
                        rl.question('\nPress ENTER when ready: ', () => {
                            rl.close();
                            // Check if next button exists after user intervention
                            resolve(true);
                        });
                    });
                    
                    // Check again if next page button is available after user intervention
                    const nextPageInfoAfterPause = await this.page.evaluate(() => {
                        const nextSelectors = [
                            'a[title="Go to next page"]',
                            '.pagination .next:not(.disabled)',
                            '.pagination a[title*="next"]',
                            '.pagination a[aria-label*="Next"]',
                            'a[href*="navigation-next"]'
                        ];
                        
                        for (const selector of nextSelectors) {
                            const nextButton = document.querySelector(selector);
                            if (nextButton && !nextButton.classList.contains('disabled')) {
                                return { exists: true };
                            }
                        }
                        return { exists: false };
                    });
                    
                    if (nextPageInfoAfterPause.exists) {
                        console.log('✅ Next page button found after user intervention. Continuing...');
                        hasNextPage = true;
                        // Don't increment currentPage here, let the next iteration handle it
                    } else {
                        console.log('🏁 Confirmed: No next page available. Ending pagination.');
                        hasNextPage = false;
                    }
                }
                
                // Add delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Calculate and display final statistics
            const paginationEndTime = Date.now();
            const totalTime = (paginationEndTime - paginationStartTime) / 1000; // in seconds
            const avgTimePerPage = pageTimes.length > 0 ? pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length : 0;
            
            const hours = Math.floor(totalTime / 3600);
            const minutes = Math.floor((totalTime % 3600) / 60);
            const seconds = Math.floor(totalTime % 60);
            let totalTimeFormatted = '';
            if (hours > 0) {
                totalTimeFormatted = `${hours}h ${minutes}m ${seconds}s`;
            } else if (minutes > 0) {
                totalTimeFormatted = `${minutes}m ${seconds}s`;
            } else {
                totalTimeFormatted = `${seconds}s`;
            }
            
            console.log(`\n🎉 Completed pagination. Total pages processed: ${currentPage}`);
            console.log(`📊 Total unique records extracted: ${this.outputData.length}`);
            console.log(`🔄 Cache contains: ${this.resultCache.length} recent results`);
            console.log(`⏱️  Total time: ${totalTimeFormatted} | Average: ${avgTimePerPage.toFixed(2)}s/page`);
            if (totalResults > 0) {
                console.log(`📈 Completion: ${processedRecords}/${totalResults} records (${((processedRecords/totalResults)*100).toFixed(2)}%)`);
            }
            
            // Provide reason for stopping
            if (consecutiveDuplicatePages >= this.maxDuplicatePages) {
                console.log(`🛑 Stopped due to ${this.maxDuplicatePages} consecutive pages with all duplicate results`);
            } else if (!hasNextPage) {
                console.log(`🏁 Stopped because no more pages are available (reached end of results)`);
            } else {
                console.log(`⏹️ Stopped due to pagination loading issues`);
            };
            
        } catch (error) {
            console.error('Error during pagination:', error);
            
            // Check if this is a DOM-related error that might be recoverable
            if (error.message.includes('Cannot read properties of null') || 
                error.message.includes('textContent') ||
                error.message.includes('querySelector')) {
                
                console.log('\n🔧 DOM access error detected - this might be recoverable with manual intervention');
                
                // Pause for manual fix
                await this.pauseForManualFix(error.message);
                
                // Try to continue pagination after manual fix
                try {
                    console.log('🔄 Attempting to resume pagination...');
                    
                    // Check if we can still get pagination info
                    const pageInfo = await this.getPaginationInfo();
                    if (pageInfo.found) {
                        console.log(`✅ Page info recovered: ${pageInfo.currentRange}`);
                        console.log('🔄 Continuing pagination from current position...');
                        
                        // Continue the pagination loop (this will need manual continuation)
                        // For now, we'll just continue with whatever data we have
                    } else {
                        console.log('❌ Could not recover pagination info after manual fix');
                    }
                } catch (resumeError) {
                    console.error('❌ Failed to resume pagination after manual fix:', resumeError.message);
                }
            }
            
            // Continue with whatever data we have
            console.log('📊 Continuing with collected data...');
        }
    }

    async savePageData(pageData) {
        // Write header if file doesn't exist
        if (!fs.existsSync(this.outputFile)) {
            let headers = [];
            
            if (this.mode === 1) { // Trademarks
                headers = [
                    "ID",
                    "Nhãn hiệu",
                    "Số đơn gốc",
                    "Ngày nộp đơn",
                    "Số công bố",
                    "Ngày công bố",
                    "Số bằng",
                    "Ngày cấp",
                    "Nhóm sản phẩm/dịch vụ",
                    "Phân loại Viên",
                    "Chủ đơn/Chủ bằng",
                    "Trạng thái"
                ];
            } else if (this.mode === 2) { // Patents
                headers = [
                    "ID",
                    "Tên sáng chế",
                    "Số đơn gốc",
                    "Ngày nộp đơn",
                    "Số công bố",
                    "Ngày công bố",
                    "Số bằng",
                    "Ngày cấp",
                    "Phân loại IPC",
                    "Chủ đơn/Chủ bằng",
                    "Người phát minh",
                    "Trạng thái"
                ];
            } else if (this.mode === 3) { // Designs
                headers = [
                    "ID",
                    "Trạng thái",
                    "Tên",
                    "Số đơn gốc",
                    "Ngày nộp đơn",
                    "Số công bố",
                    "Ngày công bố",
                    "Mã Nước ưu tiên",
                    "Số đơn ưu tiên",
                    "Ngày đơn ưu tiên",
                    "Phân loại Locarno",
                    "Số bằng",
                    "Ngày cấp",
                    "Chủ đơn/Chủ bằng",
                    "Tác giả kiểu dáng"
                ];
            }
            
            fs.writeFileSync(this.outputFile, headers.join('\t') + '\n');
        }
        
        // Append page data
        pageData.forEach(record => {
            fs.appendFileSync(this.outputFile, record.join('\t') + '\n');
        });
    }

    formatDataForOutput() {
        if (this.outputData.length === 0) {
            return '';
        }
        
        // Create headers based on mode
        let headers = [];
        
        if (this.mode === 1) { // Trademarks
            headers = [
                "ID",
                "Nhãn hiệu",
                "Số đơn gốc",
                "Ngày nộp đơn",
                "Số công bố",
                "Ngày công bố",
                "Số bằng",
                "Ngày cấp",
                "Nhóm sản phẩm/dịch vụ",
                "Phân loại Viên",
                "Chủ đơn/Chủ bằng",
                "Trạng thái"
            ];
        } else if (this.mode === 2) { // Patents
            headers = [
                "ID",
                "Tên sáng chế",
                "Số đơn gốc",
                "Ngày nộp đơn",
                "Số công bố",
                "Ngày công bố",
                "Số bằng",
                "Ngày cấp",
                "Phân loại IPC",
                "Chủ đơn/Chủ bằng",
                "Người phát minh",
                "Trạng thái"
            ];
        } else if (this.mode === 3) { // Designs
            headers = [
                "ID",
                "Trạng thái",
                "Tên",
                "Số đơn gốc",
                "Ngày nộp đơn",
                "Số công bố",
                "Ngày công bố",
                "Mã Nước ưu tiên",
                "Số đơn ưu tiên",
                "Ngày đơn ưu tiên",
                "Phân loại Locarno",
                "Số bằng",
                "Ngày cấp",
                "Chủ đơn/Chủ bằng",
                "Tác giả kiểu dáng"
            ];
        }
        
        let output = '';
        
        // Add header if file doesn't exist or is empty
        if (!fs.existsSync(this.outputFile) || fs.statSync(this.outputFile).size === 0) {
            output = headers.join('\t') + '\n';
        }
        
        // Add data rows
        this.outputData.forEach(record => {
            output += record.join('\t') + '\n';
        });
        
        return output;
    }

    writeToGlobalTracking() {
        // Write to separate global tracking file with run date (separate from main WIPO tracking)
        const today = new Date();
        const runDate = today.getFullYear() + '-' + 
                       String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                       String(today.getDate()).padStart(2, '0');
        
        const config = this.modeConfig[this.mode];
        
        // Check if global tracking file exists, if not create header
        if (!fs.existsSync(this.globalTrackingFile) || fs.statSync(this.globalTrackingFile).size === 0) {
            const header = "Run_Date\tID\tSource\tMode\tData\n";
            fs.writeFileSync(this.globalTrackingFile, header);
        }
        
        // Add entries to global tracking with source identifier
        this.outputData.forEach(record => {
            const id = record[0]; // ID is first column
            const source = `NextPage_${config.name}_Scraper`;
            const dataString = record.slice(1).join('\t'); // All data except ID
            const globalEntry = `${runDate}\t${id}\t${source}\t${config.name}\t${dataString}\n`;
            fs.appendFileSync(this.globalTrackingFile, globalEntry);
        });
    }

    async saveToFile() {
        if (this.outputData.length === 0) {
            console.log('No data to save');
            return null;
        }

        const formattedData = this.formatDataForOutput();
        
        try {
            // Write to type-specific file (NH_NextPage_DATE.txt)
            fs.appendFileSync(this.outputFile, formattedData);
            console.log(`Data saved to: ${this.outputFile}`);
            
            // Write to separate global tracking file
            this.writeToGlobalTracking();
            console.log(`NextPage global tracking updated: ${this.globalTrackingFile}`);
            
            console.log(`Total records extracted: ${this.outputData.length}`);
            return this.outputFile;
        } catch (error) {
            console.error('Error saving file:', error);
            throw error;
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }

    async run() {
        try {
            // First, let user select mode
            await this.selectMode();
            
            await this.init();
            await this.navigateToPage();
            
            // Wait for user to manually set up filters and settings
            await this.waitForUserInput();
            
            console.log('\n🚀 Starting automated scraping with duplicate detection...');
            console.log(`📝 Cache configuration: Max ${this.maxCacheSize} results, stop after ${this.maxDuplicatePages} consecutive duplicate pages`);
            
            // Now start automatic scraping and pagination
            await this.handlePagination(); // This now saves data after each page
            
            // Final statistics
            this.printFinalSummary();
            
        } catch (error) {
            console.error('Error during scraping:', error);
        } finally {
            await this.cleanup();
        }
    }

    printFinalSummary() {
        console.log('\n📋 SCRAPING SUMMARY');
        console.log('==================');
        console.log(`✅ Total unique records extracted: ${this.outputData.length}`);
        console.log(`🔄 Cache contains: ${this.resultCache.length} recent results`);
        console.log(`📄 Output file: ${this.outputFile}`);
        console.log(`🕒 Completed at: ${new Date().toLocaleString()}`);
        
        if (this.outputData.length > 0) {
            console.log(`\n📊 Sample of first few records:`);
            this.outputData.slice(0, 3).forEach((record, index) => {
                console.log(`   ${index + 1}. ${record[0]} - ${record[1] || 'N/A'}`);
            });
            
            console.log(`\n📊 Sample of last few records:`);
            this.outputData.slice(-3).forEach((record, index) => {
                const actualIndex = this.outputData.length - 3 + index + 1;
                console.log(`   ${actualIndex}. ${record[0]} - ${record[1] || 'N/A'}`);
            });
        }
        
        console.log('\n💡 Tip: Check the pagination output above for any data gaps or unexpected jumps.');
    }
}

// Run the scraper
async function main() {
    console.log('Starting WIPO Trademark Scraper...');
    const scraper = new WipoTrademarkScraper();
    await scraper.run();
    console.log('Scraping completed!');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT. Graceful shutdown...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM. Graceful shutdown...');
    process.exit(0);
});

// Run the main function
main().catch(console.error);
