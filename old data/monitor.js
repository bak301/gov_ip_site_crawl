const fs = require('fs');
const path = require('path');

/**
 * Simple monitoring script to track scraping progress
 * Usage: node monitor.js [output_directory]
 */

function getLatestOutputDir() {
  const resultsDir = path.join(__dirname, 'Results');
  if (!fs.existsSync(resultsDir)) {
    return null;
  }
  
  const dirs = fs.readdirSync(resultsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'Old')
    .map(d => ({ name: d.name, path: path.join(resultsDir, d.name) }))
    .sort((a, b) => {
      const aTime = fs.statSync(a.path).mtimeMs;
      const bTime = fs.statSync(b.path).mtimeMs;
      return bTime - aTime;
    });
    
  return dirs.length > 0 ? dirs[0].path : null;
}

function analyzeProgress(outputDir) {
  if (!outputDir || !fs.existsSync(outputDir)) {
    console.log('❌ No valid output directory found');
    return;
  }

  console.log(`📊 Analyzing progress in: ${path.basename(outputDir)}\n`);

  const stats = {
    patents: { count: 0, size: 0 },
    trademarks: { count: 0, size: 0 },
    designs: { count: 0, size: 0 },
    total: { count: 0, size: 0 }
  };

  // Check original ID count
  const originalIDPath = path.join(outputDir, 'original_ID.csv');
  let totalIDs = 0;
  if (fs.existsSync(originalIDPath)) {
    const content = fs.readFileSync(originalIDPath, 'utf-8');
    totalIDs = content.split('\n').filter(Boolean).length;
  }

  // Analyze each type
  ['Patents', 'Trademarks', 'Designs'].forEach(type => {
    const typeDir = path.join(outputDir, type);
    if (fs.existsSync(typeDir)) {
      const files = fs.readdirSync(typeDir).filter(f => f.startsWith('output-'));
      
      files.forEach(file => {
        const filePath = path.join(typeDir, file);
        const stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        const count = Math.max(0, lines.length - 1); // Subtract header
        
        const typeKey = type.toLowerCase();
        stats[typeKey].count += count;
        stats[typeKey].size += stat.size;
        stats.total.count += count;
        stats.total.size += stat.size;
      });
    }
  });

  // Display results
  console.log('📈 PROGRESS SUMMARY');
  console.log('='.repeat(50));
  console.log(`📋 Total IDs to process: ${totalIDs}`);
  console.log(`✅ Total processed: ${stats.total.count}`);
  console.log(`📊 Progress: ${totalIDs > 0 ? ((stats.total.count / totalIDs) * 100).toFixed(1) : 0}%`);
  console.log(`💾 Total output size: ${(stats.total.size / 1024 / 1024).toFixed(2)} MB\n`);

  console.log('📁 BY TYPE:');
  ['patents', 'trademarks', 'designs'].forEach(type => {
    if (stats[type].count > 0) {
      console.log(`   ${type.toUpperCase()}: ${stats[type].count} records (${(stats[type].size / 1024).toFixed(1)} KB)`);
    }
  });

  // Check for failed IDs
  const failedIDPath = path.join(outputDir, 'fail_id.txt');
  if (fs.existsSync(failedIDPath)) {
    const failedContent = fs.readFileSync(failedIDPath, 'utf-8');
    const failedCount = failedContent.split('\n').filter(Boolean).length;
    if (failedCount > 0) {
      console.log(`\n❌ Failed IDs: ${failedCount}`);
    }
  }

  // Check log file for recent activity
  const logPath = path.join(outputDir, 'log.txt');
  if (fs.existsSync(logPath)) {
    const logStat = fs.statSync(logPath);
    const timeSinceLastUpdate = (Date.now() - logStat.mtimeMs) / 1000;
    console.log(`\n📝 Log last updated: ${timeSinceLastUpdate.toFixed(0)}s ago`);
    
    if (timeSinceLastUpdate < 60) {
      console.log('🟢 Status: Active');
    } else if (timeSinceLastUpdate < 300) {
      console.log('🟡 Status: Recently active');
    } else {
      console.log('🔴 Status: Inactive');
    }
  }

  console.log('\n');
}

function watchProgress(outputDir, interval = 10000) {
  console.log(`👀 Watching progress every ${interval/1000}s (Ctrl+C to stop)...\n`);
  
  const watch = () => {
    console.clear();
    console.log(`🕒 ${new Date().toLocaleString()}`);
    analyzeProgress(outputDir);
  };
  
  watch(); // Initial display
  const intervalId = setInterval(watch, interval);
  
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.log('\n👋 Monitoring stopped');
    process.exit(0);
  });
}

// Main execution
const args = process.argv.slice(2);
const outputDir = args[0] || getLatestOutputDir();

if (args.includes('--watch') || args.includes('-w')) {
  const interval = parseInt(args.find(arg => arg.startsWith('--interval='))?.split('=')[1]) || 10000;
  watchProgress(outputDir, interval);
} else {
  analyzeProgress(outputDir);
}
