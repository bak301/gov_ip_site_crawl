const fs = require('fs');
const path = require('path');

/**
 * Adaptive configuration manager that adjusts scraping parameters based on success rates
 */

class AdaptiveConfig {
  constructor() {
    this.configFile = 'config.json';
    this.baseConfig = this.loadConfig();
    this.performanceHistory = [];
    this.adaptationRules = {
      // If success rate < 50%, reduce load
      lowSuccess: {
        threshold: 0.5,
        adjustments: {
          threadCount: -2,
          betweenRequests: +500,
          retryDelayBase: +1000
        }
      },
      // If success rate > 90%, can increase load slightly
      highSuccess: {
        threshold: 0.9,
        adjustments: {
          threadCount: +1,
          betweenRequests: -200,
          retryDelayBase: -200
        }
      },
      // If too many 500 errors, back off significantly
      serverOverload: {
        threshold: 0.7, // 70% server errors
        adjustments: {
          threadCount: -4,
          betweenRequests: +1000,
          retryDelayBase: +2000
        }
      }
    };
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        return JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
      }
    } catch (error) {
      console.warn('⚠️ Could not load config.json, using defaults');
    }
    
    // Default configuration
    return {
      scraping: {
        threadCount: 8,
        retryLimit: 15,
        delays: {
          betweenRequests: 2000,
          retryDelayBase: 3000,
          retryDelayMultiplier: 1.5
        }
      }
    };
  }

  saveConfig(config) {
    try {
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`⚙️ Updated configuration saved to ${this.configFile}`);
    } catch (error) {
      console.error('❌ Failed to save config:', error.message);
    }
  }

  analyzePerformance(logFile) {
    try {
      if (!fs.existsSync(logFile)) return null;
      
      const logContent = fs.readFileSync(logFile, 'utf-8');
      const lines = logContent.split('\n');
      
      let totalRequests = 0;
      let successfulRequests = 0;
      let serverErrors = 0;
      let timeouts = 0;
      
      for (const line of lines) {
        if (line.includes('HTTP Status:')) {
          totalRequests++;
          if (line.includes('200 - OK')) {
            successfulRequests++;
          } else if (line.includes('500 - Internal Server Error')) {
            serverErrors++;
          } else if (line.includes('timeout') || line.includes('TIMEOUT')) {
            timeouts++;
          }
        }
      }
      
      return {
        totalRequests,
        successfulRequests,
        serverErrors,
        timeouts,
        successRate: totalRequests > 0 ? successfulRequests / totalRequests : 0,
        serverErrorRate: totalRequests > 0 ? serverErrors / totalRequests : 0,
        timeoutRate: totalRequests > 0 ? timeouts / totalRequests : 0
      };
    } catch (error) {
      console.warn('⚠️ Could not analyze performance:', error.message);
      return null;
    }
  }

  adaptConfiguration(performance) {
    if (!performance) return this.baseConfig;
    
    let newConfig = JSON.parse(JSON.stringify(this.baseConfig));
    let adjustmentsMade = [];
    
    // Check for server overload (high 500 error rate)
    if (performance.serverErrorRate >= this.adaptationRules.serverOverload.threshold) {
      console.log(`🚨 High server error rate detected: ${(performance.serverErrorRate * 100).toFixed(1)}%`);
      this.applyAdjustments(newConfig, this.adaptationRules.serverOverload.adjustments);
      adjustmentsMade.push('Reduced load due to server overload');
    }
    // Check for low success rate
    else if (performance.successRate < this.adaptationRules.lowSuccess.threshold) {
      console.log(`⚠️ Low success rate detected: ${(performance.successRate * 100).toFixed(1)}%`);
      this.applyAdjustments(newConfig, this.adaptationRules.lowSuccess.adjustments);
      adjustmentsMade.push('Reduced load due to low success rate');
    }
    // Check for high success rate (can increase load)
    else if (performance.successRate >= this.adaptationRules.highSuccess.threshold) {
      console.log(`🚀 High success rate detected: ${(performance.successRate * 100).toFixed(1)}%`);
      this.applyAdjustments(newConfig, this.adaptationRules.highSuccess.adjustments);
      adjustmentsMade.push('Increased load due to high success rate');
    }
    
    // Apply safety limits
    newConfig.scraping.threadCount = Math.max(2, Math.min(20, newConfig.scraping.threadCount));
    newConfig.scraping.delays.betweenRequests = Math.max(500, Math.min(10000, newConfig.scraping.delays.betweenRequests));
    newConfig.scraping.delays.retryDelayBase = Math.max(1000, Math.min(15000, newConfig.scraping.delays.retryDelayBase));
    
    if (adjustmentsMade.length > 0) {
      console.log(`🔧 Configuration adjustments: ${adjustmentsMade.join(', ')}`);
      console.log(`   Threads: ${newConfig.scraping.threadCount}`);
      console.log(`   Request delay: ${newConfig.scraping.delays.betweenRequests}ms`);
      console.log(`   Retry delay: ${newConfig.scraping.delays.retryDelayBase}ms`);
      
      this.saveConfig(newConfig);
    }
    
    return newConfig;
  }

  applyAdjustments(config, adjustments) {
    if (adjustments.threadCount) {
      config.scraping.threadCount += adjustments.threadCount;
    }
    if (adjustments.betweenRequests) {
      config.scraping.delays.betweenRequests += adjustments.betweenRequests;
    }
    if (adjustments.retryDelayBase) {
      config.scraping.delays.retryDelayBase += adjustments.retryDelayBase;
    }
  }

  getLatestLogFile() {
    try {
      const resultsDir = 'Results';
      if (!fs.existsSync(resultsDir)) return null;
      
      const dirs = fs.readdirSync(resultsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== 'Old')
        .map(d => ({ name: d.name, path: path.join(resultsDir, d.name) }))
        .sort((a, b) => {
          const aTime = fs.statSync(a.path).mtimeMs;
          const bTime = fs.statSync(b.path).mtimeMs;
          return bTime - aTime;
        });
        
      if (dirs.length > 0) {
        const logFile = path.join(dirs[0].path, 'log.txt');
        return fs.existsSync(logFile) ? logFile : null;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  optimizeForNextRun() {
    console.log('\n🔍 Analyzing previous run performance...');
    
    const logFile = this.getLatestLogFile();
    if (!logFile) {
      console.log('📝 No log file found, using default configuration');
      return this.baseConfig;
    }
    
    const performance = this.analyzePerformance(logFile);
    if (!performance) {
      console.log('⚠️ Could not analyze performance, using current configuration');
      return this.baseConfig;
    }
    
    console.log(`📊 Performance analysis:`);
    console.log(`   Total requests: ${performance.totalRequests}`);
    console.log(`   Success rate: ${(performance.successRate * 100).toFixed(1)}%`);
    console.log(`   Server error rate: ${(performance.serverErrorRate * 100).toFixed(1)}%`);
    console.log(`   Timeout rate: ${(performance.timeoutRate * 100).toFixed(1)}%`);
    
    this.performanceHistory.push(performance);
    
    return this.adaptConfiguration(performance);
  }
}

module.exports = AdaptiveConfig;
