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
                fileName: 'NH_Patents',
                rowSelector: 'tr.odd, tr.even'
            },
            3: {
                name: 'Designs',
                url: 'https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/designs?3&query=OFCO:VN',
                fileName: 'NH_Designs',
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

    async init() {
        console.log('Initializing Puppeteer browser...');
        this.browser = await puppeteer.launch({
            headless: false, // Set to true for production
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
        
        // Set user agent to avoid blocking
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Set viewport
        await this.page.setViewport({ width: 1920, height: 1080 });
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

    async extractTrademarkData() {
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
            console.log(`Extracted ${extractedData.length} records from current page. Total so far: ${this.outputData.length}`);
            
            return extractedData;
            
        } catch (error) {
            console.error(`Error extracting ${config.name.toLowerCase()} data:`, error);
            throw error;
        }
    }

    async handlePagination() {
        const config = this.modeConfig[this.mode];
        console.log(`Starting pagination handling for ${config.name}...`);
        
        try {
            let hasNextPage = true;
            let currentPage = 1;
            
            // Clear the output file first to start fresh
            if (fs.existsSync(this.outputFile)) {
                fs.unlinkSync(this.outputFile);
                console.log('🗑️ Cleared existing output file to start fresh');
            }
            
            while (hasNextPage) {
                
                // Extract data from current page
                const pageData = await this.extractTrademarkData();
                
                if (pageData.length === 0) {
                    console.log('No data found on current page, stopping pagination');
                    break;
                }
                
                // Save data immediately after each page
                await this.savePageData(pageData);

                // Check if there's a next page button and if it's clickable
                const nextPageInfo = await this.page.evaluate(() => {
                    // Look for various next page selectors
                    const nextSelectors = [
                        'a[title="Go to next page"]',
                        '.pagination .next:not(.disabled)',
                        '.pagination a[title*="next"]',
                        '.pagination a[aria-label*="Next"]',
                        'a[href*="navigation-next"]'
                    ];
                    
                    let nextButton = null;
                    for (const selector of nextSelectors) {
                        nextButton = document.querySelector(selector);
                        if (nextButton && !nextButton.classList.contains('disabled')) {
                            break;
                        }
                    }
                    
                    if (nextButton && !nextButton.classList.contains('disabled')) {
                        return {
                            exists: true,
                            href: nextButton.href,
                            text: nextButton.textContent.trim()
                        };
                    }
                    
                    return { exists: false };
                });
                
                if (nextPageInfo.exists) {
                    
                    // Click the next page button
                    await this.page.evaluate(() => {
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
                                nextButton.click();
                                return;
                            }
                        }
                    });
                    
                    // Wait for the new page to load
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Wait for rows to appear on new page
                    try {
                        await this.page.waitForSelector(config.rowSelector, { timeout: 15000 });
                       
                    } catch (waitError) {
                        console.log('⚠️ Timeout waiting for content on next page, stopping pagination');
                        break;
                    }
                    
                    currentPage++;
                } else {
                    console.log('🏁 No more pages found');
                    hasNextPage = false;
                }
                
                // Add delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            console.log(`\n🎉 Completed pagination. Total pages processed: ${currentPage}`);
            console.log(`📊 Total records extracted: ${this.outputData.length}`);
            
        } catch (error) {
            console.error('Error during pagination:', error);
            // Continue with whatever data we have
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
            
            // Now start automatic scraping and pagination
            await this.handlePagination(); // This now saves data after each page
            
            // Write final global tracking
            this.writeToGlobalTracking();
            console.log(`\n✅ Final output saved to: ${this.outputFile}`);
            console.log(`📊 Total records: ${this.outputData.length}`);
            
        } catch (error) {
            console.error('Error during scraping:', error);
        } finally {
            await this.cleanup();
        }
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
