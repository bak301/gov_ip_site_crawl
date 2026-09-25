'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function parseArguments(argv) {
    const args = { input: null, db: null };
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--input') args.input = argv[++index];
        else if (argv[index] === '--db') args.db = argv[++index];
        else if (!args.input) args.input = argv[index];
    }
    args.input = path.resolve(args.input || path.join(__dirname, 'WIPO_NextPage_Global_Tracking.txt'));
    args.db = path.resolve(args.db || path.join(__dirname, 'WIPO_Application_History.sqlite'));
    return args;
}

function main() {
    const args = parseArguments(process.argv.slice(2));
    const python = process.env.WIPO_PYTHON || 'python';
    const helper = path.join(__dirname, 'wipo_database_helper.py');
    const result = spawnSync(
        python,
        [helper, 'import', '--input', args.input, '--db', args.db],
        { stdio: 'inherit', windowsHide: false }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = { parseArguments };
