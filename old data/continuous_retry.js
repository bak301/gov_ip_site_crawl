const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdaptiveConfig = require('./adaptive_config');

/**
 * Continuous retry script that keeps running the main scraper until all IDs are processed
 * Now includes adaptive configuration management
 */

class ContinuousRetry {
  constructor() {
    this.maxAttempts = 20; // Increased max attempts
    this.currentAttempt = 0;
    this.baseDelayBetweenAttempts = 60000; // 1 minute base delay
    this.inputFile = 'ID.csv';
    this.resultsDir = 'Results';
    this.adaptiveConfig = new AdaptiveConfig();
    this.lastSuccessfulCount = 0;
  }

  async getProgress() {
    try {
      // Read original IDs
      const originalIDs = fs.readFileSync(this.inputFile, 'utf-8')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);

      // Find latest output directory
      const latestDir = this.getLatestOutputDir();
      if (!latestDir) {
        return { total: originalIDs.length, processed: 0, remaining: originalIDs.length };
      }

      // Count processed IDs from all output files
      const processedIDs = new Set();
      const outputTypes = ['Patents', 'Trademarks', 'Designs'];
      
      for (const type of outputTypes) {
        const typeDir = path.join(latestDir, type);
        if (fs.existsSync(typeDir)) {
          const files = fs.readdirSync(typeDir).filter(f => f.startsWith('output-'));
          for (const file of files) {
            const filePath = path.join(typeDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').slice(1); // Skip header
            for (const line of lines) {
              const id = line.split('\t')[0]?.trim();
              if (id && id !== 'No data available after') {
                processedIDs.add(id);
              }
            }
          }
        }
      }

      return {
        total: originalIDs.length,
        processed: processedIDs.size,
        remaining: originalIDs.length - processedIDs.size,
        processedIDs: Array.from(processedIDs),
        originalIDs
      };
    } catch (error) {
      console.error('Error getting progress:', error.message);
      return { total: 0, processed: 0, remaining: 0 };
    }
  }

  getLatestOutputDir() {
    try {
      if (!fs.existsSync(this.resultsDir)) return null;
      
      const dirs = fs.readdirSync(this.resultsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== 'Old')
        .map(d => ({ name: d.name, path: path.join(this.resultsDir, d.name) }))
        .sort((a, b) => {
          const aTime = fs.statSync(a.path).mtimeMs;
          const bTime = fs.statSync(b.path).mtimeMs;
          return bTime - aTime;
        });
        
      return dirs.length > 0 ? dirs[0].path : null;
    } catch (error) {
      return null;
    }
  }

  async runMainScript() {
    return new Promise((resolve, reject) => {
      console.log(`\n🚀 Starting attempt ${this.currentAttempt + 1}/${this.maxAttempts}...`);
      
      const child = spawn('node', ['index.js'], {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Attempt ${this.currentAttempt + 1} completed successfully`);
          resolve(true);
        } else {
          console.log(`⚠️ Attempt ${this.currentAttempt + 1} exited with code ${code}`);
          resolve(false);
        }
      });

      child.on('error', (error) => {
        console.error(`❌ Error in attempt ${this.currentAttempt + 1}:`, error.message);
        reject(error);
      });
    });
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  async start() {
    console.log('🔄 Starting intelligent continuous retry process...');
    console.log(`📋 Configuration: ${this.maxAttempts} max attempts with adaptive optimization\n`);

    const startTime = Date.now();
    let lastProgress = { processed: 0 };
    let consecutiveNoProgress = 0;
    const maxNoProgressAttempts = 3;

    while (this.currentAttempt < this.maxAttempts) {
      try {
        // Optimize configuration based on previous performance
        if (this.currentAttempt > 0) {
          console.log(`\n🧠 Optimizing configuration for attempt ${this.currentAttempt + 1}...`);
          this.adaptiveConfig.optimizeForNextRun();
        }

        // Check current progress
        const progress = await this.getProgress();
        const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        
        console.log(`\n📊 PROGRESS UPDATE (Attempt ${this.currentAttempt + 1})`);
        console.log(`${'='.repeat(50)}`);
        console.log(`✅ Processed: ${progress.processed}/${progress.total} (${((progress.processed/progress.total)*100).toFixed(1)}%)`);
        console.log(`⏳ Remaining: ${progress.remaining}`);
        console.log(`⏱️ Elapsed time: ${this.formatTime(elapsedTime)}`);
        
        // Check for progress
        if (progress.processed > lastProgress.processed) {
          const newlyProcessed = progress.processed - lastProgress.processed;
          console.log(`🎉 +${newlyProcessed} new IDs processed since last attempt!`);
          consecutiveNoProgress = 0;
          this.lastSuccessfulCount = progress.processed;
        } else if (this.currentAttempt > 0) {
          consecutiveNoProgress++;
          console.log(`⚠️ No progress in ${consecutiveNoProgress} consecutive attempts`);
        }

        // Check if all IDs are processed
        if (progress.remaining === 0) {
          console.log(`\n🎉 SUCCESS! All ${progress.total} IDs have been processed!`);
          console.log(`⏱️ Total time: ${this.formatTime(elapsedTime)}`);
          console.log(`📁 Results directory: ${this.getLatestOutputDir()}`);
          break;
        }

        // If no progress for too many attempts, increase delay and reduce load
        if (consecutiveNoProgress >= maxNoProgressAttempts) {
          console.log(`\n🛑 No progress for ${consecutiveNoProgress} attempts. Applying conservative settings...`);
          this.applyConservativeSettings();
          consecutiveNoProgress = 0; // Reset counter
        }

        // Run the main script
        await this.runMainScript();
        
        lastProgress = progress;
        this.currentAttempt++;

        // Calculate adaptive delay based on progress
        const delayBetweenAttempts = this.calculateAdaptiveDelay(progress, consecutiveNoProgress);

        // If not the last attempt, wait before next retry
        if (this.currentAttempt < this.maxAttempts) {
          const nextProgress = await this.getProgress();
          if (nextProgress.remaining > 0) {
            console.log(`\n⏸️ Waiting ${delayBetweenAttempts/1000}s before next attempt...`);
            await this.delay(delayBetweenAttempts);
          }
        }

      } catch (error) {
        console.error(`❌ Error in attempt ${this.currentAttempt + 1}:`, error.message);
        this.currentAttempt++;
        
        if (this.currentAttempt < this.maxAttempts) {
          const errorDelay = this.baseDelayBetweenAttempts * 2; // Double delay on error
          console.log(`⏸️ Waiting ${errorDelay/1000}s before retry due to error...`);
          await this.delay(errorDelay);
        }
      }
    }

    // Final summary
    const finalProgress = await this.getProgress();
    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 FINAL SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`🔄 Total attempts: ${this.currentAttempt}`);
    console.log(`✅ Successfully processed: ${finalProgress.processed}/${finalProgress.total}`);
    console.log(`❌ Still remaining: ${finalProgress.remaining}`);
    console.log(`📈 Success rate: ${((finalProgress.processed/finalProgress.total)*100).toFixed(1)}%`);
    console.log(`⏱️ Total execution time: ${this.formatTime(totalTime)}`);
    console.log(`📁 Output directory: ${this.getLatestOutputDir()}`);

    if (finalProgress.remaining > 0) {
      console.log(`\n⚠️ ${finalProgress.remaining} IDs still need processing`);
      console.log(`💡 Consider running this script again later or checking server availability`);
      
      // Save remaining IDs for manual retry
      const remainingIDs = finalProgress.originalIDs.filter(id => 
        !finalProgress.processedIDs.includes(id)
      );
      
      const remainingFile = 'remaining_IDs.csv';
      fs.writeFileSync(remainingFile, remainingIDs.join('\n'), 'utf-8');
      console.log(`📄 Remaining IDs saved to: ${remainingFile}`);
      
      // Suggest optimal retry time
      const nextRetryTime = new Date(Date.now() + (4 * 60 * 60 * 1000)); // 4 hours later
      console.log(`🕐 Suggested retry time: ${nextRetryTime.toLocaleString()}`);
    } else {
      console.log(`\n🎉 COMPLETE SUCCESS! All IDs processed!`);
    }
  }

  calculateAdaptiveDelay(progress, consecutiveNoProgress) {
    let delay = this.baseDelayBetweenAttempts;
    
    // Increase delay if no progress
    if (consecutiveNoProgress > 0) {
      delay *= Math.pow(1.5, consecutiveNoProgress);
    }
    
    // Reduce delay if good progress rate
    const progressRate = progress.processed / progress.total;
    if (progressRate > 0.8) {
      delay *= 0.7; // Reduce delay when close to completion
    } else if (progressRate > 0.5) {
      delay *= 0.85;
    }
    
    // Cap the delay between 30 seconds and 10 minutes
    return Math.max(30000, Math.min(600000, delay));
  }

  applyConservativeSettings() {
    const conservativeConfig = {
      scraping: {
        threadCount: 4,
        retryLimit: 25,
        delays: {
          betweenRequests: 4000,
          retryDelayBase: 5000,
          retryDelayMultiplier: 2.0
        }
      }
    };
    
    this.adaptiveConfig.saveConfig(conservativeConfig);
    console.log(`⚙️ Applied conservative settings: 4 threads, 4s delays`);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️ Graceful shutdown requested...');
  process.exit(0);
});

// Start the continuous retry process
const retryManager = new ContinuousRetry();
retryManager.start().catch(error => {
  console.error('💥 Fatal error in continuous retry:', error);
  process.exit(1);
});
