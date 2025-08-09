const fs = require('fs');

// Test the utility functions
const utils = {
  delay: (ms, jitter = 0.1) => {
    const jitterAmount = ms * jitter * Math.random();
    return new Promise(resolve => setTimeout(resolve, ms + jitterAmount));
  },

  isValidID: (id) => {
    if (!id || typeof id !== 'string') return false;
    const trimmedId = id.trim();
    if (trimmedId.length === 0) return false;
    
    // Support both formats: 1-2021-04006 (with year) or 1-04006 (without year)
    return /^\d+-(\d{4}-)?(\d{4,})$/.test(trimmedId);
  },

  getRetryDelay: (attempt) => {
    const RETRY_DELAY_BASE = 2000;
    const RETRY_DELAY_MULTIPLIER = 1.5;
    return RETRY_DELAY_BASE * Math.pow(RETRY_DELAY_MULTIPLIER, attempt);
  },
};

// Test ScrapingState class
class ScrapingState {
  constructor() {
    this.failedQueue = [];
    this.completedIDs = new Set();
    this.processingIDs = new Set();
    this.idStartTimestamps = new Map();
    this.retryTracker = new Map();
  }

  markIDAsProcessing(id) {
    this.processingIDs.add(id);
    this.idStartTimestamps.set(id, Date.now());
  }

  markIDAsCompleted(id) {
    this.processingIDs.delete(id);
    this.completedIDs.add(id);
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
}

async function runTests() {
  console.log('🧪 Running improvement tests...\n');
  
  // Test 1: ID validation
  console.log('✅ Test 1: ID Validation');
  const testIDs = ['4-1234567', '1-2021-04006', '1-9876543', 'invalid-id', '', '4-abc', '3-2022-12345'];
  testIDs.forEach(id => {
    const isValid = utils.isValidID(id);
    console.log(`   ${id}: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
  });

  // Test 2: ScrapingState functionality
  console.log('\n✅ Test 2: ScrapingState');
  const state = new ScrapingState();
  
  state.markIDAsProcessing('4-1234567');
  console.log(`   Processing IDs: ${state.processingIDs.size}`);
  
  await utils.delay(100); // Small delay to test timing
  state.markIDAsCompleted('4-1234567');
  console.log(`   Completed IDs: ${state.completedIDs.size}`);
  console.log(`   Elapsed time for 4-1234567: ${state.getElapsedTime('4-1234567')}s`);

  // Test 3: Retry delay calculation
  console.log('\n✅ Test 3: Retry Delays');
  for (let i = 0; i < 5; i++) {
    const delay = utils.getRetryDelay(i);
    console.log(`   Attempt ${i + 1}: ${delay}ms`);
  }

  // Test 4: Configuration loading
  console.log('\n✅ Test 4: Configuration');
  try {
    if (fs.existsSync('config.json')) {
      const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
      console.log(`   Thread count: ${config.scraping.threadCount}`);
      console.log(`   Retry limit: ${config.scraping.retryLimit}`);
      console.log(`   Between requests: ${config.scraping.delays.betweenRequests}ms`);
    } else {
      console.log('   ⚠️ config.json not found');
    }
  } catch (error) {
    console.log(`   ❌ Config error: ${error.message}`);
  }

  console.log('\n🎉 All tests completed!');
}

runTests().catch(console.error);
