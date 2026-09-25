const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const child = spawn(electron, ['lan-server.js'], {
  cwd: root,
  windowsHide: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function main() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const healthResponse = await fetch('http://127.0.0.1:47834/wipo-application-tracker/api/health');
      const pageResponse = await fetch('http://127.0.0.1:47834/wipo-application-tracker/');
      const health = await healthResponse.json();
      const page = await pageResponse.text();
      if (!healthResponse.ok || !pageResponse.ok || !page.includes('WipoPublish Vietnam Search')) throw new Error('Unexpected LAN response.');
      console.log(JSON.stringify({ httpStatus: pageResponse.status, markerFound: true, pendingApplications: health.pendingApplications }));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError || new Error('LAN server did not become ready.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => child.kill());
