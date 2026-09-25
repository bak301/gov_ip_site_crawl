'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function clean(value) {
    return String(value == null ? '' : value).trim();
}

function extractApplicationNumber(value) {
    const text = clean(value).toUpperCase();
    const match = text.match(/\b(?:[A-Z]{2,5}-)?\d{1,2}-\d{4}-\d{4,}\b/);
    return match ? match[0] : text;
}

class WipoDatabase {
    constructor(filePath) {
        this.filePath = path.resolve(filePath);
        this.helperPath = path.join(__dirname, 'wipo_database_helper.py');
        this.python = process.env.WIPO_PYTHON || 'python';
        this.runHelper(['init', '--db', this.filePath]);
    }

    runHelper(args, input) {
        // On Windows, Python may otherwise decode redirected stdin using the
        // active ANSI code page even though Node writes JSON as UTF-8.  That
        // silently turns Vietnamese text such as "ĐẠI" into mojibake before
        // it reaches SQLite (and can introduce irreversible U+FFFD bytes).
        const stdin = input == null
            ? undefined
            : Buffer.from(JSON.stringify(input), 'utf8');
        const result = spawnSync(this.python, [this.helperPath, ...args], {
            encoding: 'utf8',
            input: stdin,
            env: {
                ...process.env,
                PYTHONUTF8: '1',
                PYTHONIOENCODING: 'utf-8'
            },
            maxBuffer: 32 * 1024 * 1024,
            windowsHide: true
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            throw new Error(result.stderr.trim() || `Database helper exited with ${result.status}`);
        }
        return result.stdout.trim();
    }

    mergeRecords(records, options = {}) {
        if (!Array.isArray(records) || records.length === 0) {
            return { inserted: 0, updated: 0, unchanged: 0, historical: 0, changes: 0 };
        }
        const output = this.runHelper(['merge', '--db', this.filePath], {
            records,
            mode: options.mode,
            source: options.source || 'WIPO scraper',
            observedAt: options.observedAt || new Date().toISOString()
        });
        return JSON.parse(output);
    }

    close() {
        // Each helper call commits and closes its own SQLite connection.
    }
}

module.exports = { WipoDatabase, extractApplicationNumber };
