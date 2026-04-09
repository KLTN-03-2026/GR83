import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const services = [
  {
    name: 'backend',
    command: 'npm',
    args: ['run', 'dev', '--workspace', 'backend'],
  },
  {
    name: 'frontend',
    command: 'npm',
    args: ['run', 'dev', '--workspace', 'frontend'],
  },
];

const children = new Map();
let shuttingDown = false;
const FRONTEND_PORT = 5173;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const AUTO_OPEN_CHROME = String(process.env.SMARTRIDE_AUTO_OPEN_CHROME ?? 'true').toLowerCase() !== 'false';

function sleep(milliseconds) {
  const sharedBuffer = new SharedArrayBuffer(4);
  const view = new Int32Array(sharedBuffer);
  Atomics.wait(view, 0, 0, milliseconds);
}

function parsePids(output) {
  const pids = new Set();

  for (const line of String(output ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    const pid = Number(tokens[tokens.length - 1]);

    if (Number.isFinite(pid)) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function listListeningPids(port) {
  if (process.platform === 'win32') {
    const powerShellResult = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)`,
      ],
      { encoding: 'utf8' },
    );

    const powerShellPids = parsePids(`${powerShellResult.stdout ?? ''}\n${powerShellResult.stderr ?? ''}`);

    if (powerShellPids.length > 0) {
      return powerShellPids;
    }

    const netstatResult = spawnSync('cmd', ['/d', '/s', '/c', `netstat -ano -p tcp | findstr :${port}`], {
      encoding: 'utf8',
    });

    return parsePids(`${netstatResult.stdout ?? ''}\n${netstatResult.stderr ?? ''}`);
  }

  const lsofResult = spawnSync('sh', ['-lc', `lsof -ti tcp:${port} 2>/dev/null || true`], { encoding: 'utf8' });

  return parsePids(`${lsofResult.stdout ?? ''}\n${lsofResult.stderr ?? ''}`);
}

function killPid(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore if the process already exited.
  }
}

function clearPort(port) {
  const pids = listListeningPids(port);

  for (const pid of pids) {
    killPid(pid);
  }

  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    if (listListeningPids(port).length === 0) {
      return;
    }

    sleep(200);
  }

  console.warn(`Port ${port} is still busy after cleanup; starting anyway.`);
}

function clearDevPorts() {
  for (const port of [4000, FRONTEND_PORT]) {
    clearPort(port);
  }

  sleep(300);
}

function launchDetached(command, args, options = {}) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      ...options,
    });

    child.unref();
    return true;
  } catch {
    return false;
  }
}

function openChromeOnWindows(url) {
  const candidates = [
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.env['PROGRAMFILES(X86)']
      ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const launched = launchDetached(candidate, [url], {
      windowsHide: true,
    });

    if (launched) {
      return true;
    }
  }

  const launchByAlias = launchDetached('cmd', ['/d', '/s', '/c', `start "" chrome "${url}"`], {
    windowsHide: true,
  });

  return launchByAlias;
}

function openChrome(url) {
  if (process.platform === 'win32') {
    return openChromeOnWindows(url);
  }

  if (process.platform === 'darwin') {
    return launchDetached('open', ['-a', 'Google Chrome', url]);
  }

  const linuxCommands = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];

  for (const command of linuxCommands) {
    if (launchDetached(command, [url])) {
      return true;
    }
  }

  return false;
}

function scheduleChromeOpen() {
  if (!AUTO_OPEN_CHROME) {
    return;
  }

  console.log(`Auto-open Chrome is enabled. Attempting to open ${FRONTEND_URL}...`);

  const tryOpen = (attempt = 1) => {
    if (shuttingDown) {
      return;
    }

    const opened = openChrome(FRONTEND_URL);

    if (opened) {
      console.log(`Opened Chrome at ${FRONTEND_URL}`);
      return;
    }

    if (attempt >= 3) {
      console.warn(`Could not open Chrome automatically. Open ${FRONTEND_URL} manually.`);
      return;
    }

    console.log(`Retrying Chrome auto-open (attempt ${attempt + 1}/3)...`);

    setTimeout(() => tryOpen(attempt + 1), 3_000);
  };

  setTimeout(() => tryOpen(1), 2_500);
}

function killProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
    return;
  } catch {
    // Fall through to a direct signal if the process group is unavailable.
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore if the process already exited.
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children.values()) {
    killProcessTree(child.pid);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 200);
}

clearDevPorts();

for (const service of services) {
  const child = spawn(service.command, service.args, {
    shell: true,
    detached: process.platform !== 'win32',
    stdio: 'inherit',
  });

  children.set(service.name, child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(
      `[${service.name}] exited unexpectedly${code !== null ? ` with code ${code}` : ''}${signal ? ` (${signal})` : ''}`,
    );
    shutdown(code ?? 1);
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[${service.name}] failed to start`, error);
    shutdown(1);
  });
}

scheduleChromeOpen();

function handleSignal(signal) {
  console.log(`Received ${signal}, stopping frontend and backend...`);
  shutdown(0);
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGHUP', () => handleSignal('SIGHUP'));
process.on('uncaughtException', (error) => {
  console.error(error);
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(reason);
  shutdown(1);
});
