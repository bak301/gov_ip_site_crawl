const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const readline = require('readline');

// Configuration
const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const LOGIN_URLS = {
  WIPO: 'http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/home',
  VIETNAM_TRADEMARK: 'https://vietnamtrademark.net'
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function waitForEnter(message) {
  return new Promise((resolve) => {
    rl.question(message, () => {
      resolve();
    });
  });
}

async function saveCookies(page, site) {
  try {
    const cookies = await page.cookies();
    const cookiesData = {
      [site]: {
        cookies: cookies,
        timestamp: new Date().toISOString(),
        userAgent: await page.evaluate(() => navigator.userAgent)
      }
    };
    
    // Read existing cookies file if it exists
    let existingCookies = {};
    if (fs.existsSync(COOKIES_FILE)) {
      try {
        existingCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
      } catch (error) {
        console.log('⚠️ Could not read existing cookies file, creating new one');
      }
    }
    
    // Merge with existing cookies
    const updatedCookies = {
      ...existingCookies,
      ...cookiesData
    };
    
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(updatedCookies, null, 2));
    console.log(`✅ Cookies saved for ${site} (${cookies.length} cookies)`);
    console.log(`📁 Saved to: ${COOKIES_FILE}`);
  } catch (error) {
    console.error(`❌ Error saving cookies for ${site}:`, error.message);
  }
}

async function loadExistingCookies(page, site) {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.log(`📋 No existing cookies file found`);
    return;
  }
  
  try {
    const cookiesData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    if (cookiesData[site] && cookiesData[site].cookies) {
      await page.setCookie(...cookiesData[site].cookies);
      console.log(`🍪 Loaded ${cookiesData[site].cookies.length} existing cookies for ${site}`);
      console.log(`⏰ Cookies saved on: ${cookiesData[site].timestamp}`);
    } else {
      console.log(`📋 No existing cookies found for ${site}`);
    }
  } catch (error) {
    console.log(`⚠️ Could not load existing cookies: ${error.message}`);
  }
}

async function loginSession(siteName, url) {
  console.log(`\n🚀 Starting login session for ${siteName}`);
  console.log(`🌐 URL: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
  
  try {
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    // Load existing cookies if available
    await loadExistingCookies(page, siteName);
    
    // Navigate to the site
    console.log(`📖 Navigating to ${siteName}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log(`\n🔑 Please log in manually in the browser window.`);
    console.log(`✅ Complete your login process (enter credentials, solve captcha, etc.)`);
    console.log(`⏳ When you're successfully logged in, press Enter in this terminal to save cookies and exit.`);
    
    // Wait for user to press Enter
    await waitForEnter('\n👉 Press Enter after completing login: ');
    
    // Save cookies
    await saveCookies(page, siteName);
    
  } catch (error) {
    console.error(`❌ Error during ${siteName} login:`, error.message);
  } finally {
    await browser.close();
    console.log(`🔒 Browser closed for ${siteName}`);
  }
}

async function main() {
  console.log(`🔐 Login Cookie Manager`);
  console.log(`==============================`);
  console.log(`📅 Date: ${new Date().toLocaleString()}`);
  console.log(`📁 Cookies will be saved to: ${COOKIES_FILE}`);
  
  try {
    // Ask user which site to log into
    console.log(`\n🌐 Available sites:`);
    console.log(`1. WIPO (Vietnam IP Office)`);
    console.log(`2. Vietnam Trademark`);
    console.log(`3. Both sites`);
    
    const choice = await new Promise((resolve) => {
      rl.question('\n👉 Select site (1/2/3): ', (answer) => {
        resolve(answer.trim());
      });
    });
    
    switch (choice) {
      case '1':
        await loginSession('WIPO', LOGIN_URLS.WIPO);
        break;
      case '2':
        await loginSession('VIETNAM_TRADEMARK', LOGIN_URLS.VIETNAM_TRADEMARK);
        break;
      case '3':
        await loginSession('WIPO', LOGIN_URLS.WIPO);
        console.log(`\n⏳ Moving to next site...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await loginSession('VIETNAM_TRADEMARK', LOGIN_URLS.VIETNAM_TRADEMARK);
        break;
      default:
        console.log(`❌ Invalid choice: ${choice}`);
        break;
    }
    
  } catch (error) {
    console.error(`❌ Fatal error:`, error.message);
  } finally {
    rl.close();
    console.log(`\n🎉 Login session completed!`);
    console.log(`💡 Your cookies are now saved and can be used by the scraping scripts.`);
    process.exit(0);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log(`\n⚠️ Process interrupted by user`);
  rl.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n⚠️ Process terminated`);
  rl.close();
  process.exit(0);
});

// Start the application
main().catch((error) => {
  console.error(`💥 Unhandled error:`, error.message);
  rl.close();
  process.exit(1);
});
