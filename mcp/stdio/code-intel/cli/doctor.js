import { spawnSync } from 'node:child_process';

const LANGUAGES = {
  cpp: {
    serverBinary: 'clangd',
    versionArgs: ['--version'],
    hint: 'install clangd via your package manager (apt install clangd / brew install llvm) and ensure it is on PATH'
  }
};

function checkBinary(name, args) {
  try {
    const out = spawnSync(name, args, { encoding: 'utf8', windowsHide: true });
    if (out.error || out.status !== 0) {
      return { available: false, version: '', error: out.error?.message || `exit ${out.status}` };
    }
    return { available: true, version: String(out.stdout || out.stderr).split(/\r?\n/u)[0].trim() };
  } catch (err) {
    return { available: false, version: '', error: err.message };
  }
}

export function runDoctor(args) {
  const targets = args.length > 0 ? args : Object.keys(LANGUAGES);
  for (const lang of targets) {
    const cfg = LANGUAGES[lang];
    if (!cfg) {
      process.stdout.write(`${lang}: unsupported (no provider registered)\n`);
      continue;
    }
    const status = checkBinary(cfg.serverBinary, cfg.versionArgs);
    if (status.available) {
      process.stdout.write(`${lang}: OK — ${cfg.serverBinary} ${status.version}\n`);
    } else {
      process.stdout.write(`${lang}: MISSING — ${cfg.serverBinary} (${status.error || 'not found'}); hint: ${cfg.hint}\n`);
    }
  }
  return 0;
}
