'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolveWipoHistoryPath(env = process.env) {
    const override = env.WIPO_SCRAPER_DATABASE?.trim();
    if (override) return path.resolve(override);
    const relative = path.join('wipo', 'history', 'WIPO_Application_History.sqlite');
    const databaseRoot = env.SOFTIP_DATABASE_ROOT?.trim();
    if (databaseRoot) {
        if (!path.isAbsolute(databaseRoot)) throw new Error('SOFTIP_DATABASE_ROOT must be an absolute path.');
        return path.join(databaseRoot, relative);
    }
    const relocated = path.resolve(__dirname, '..', '..', 'SoftIP_Data', 'Database', relative);
    if (fs.existsSync(relocated)) return relocated;
    return path.join(__dirname, 'WIPO_Application_History.sqlite');
}

module.exports = { resolveWipoHistoryPath };
