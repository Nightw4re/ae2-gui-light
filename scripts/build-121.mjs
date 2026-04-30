import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPng, paintDebugAtlas, writePng } from './build-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectId = process.env.BUILD_ID || process.env.npm_package_config_build_id || process.env.npm_package_name;
const buildType = process.env.BUILD_TYPE || process.env.npm_package_config_build_type || '';
const version = process.env.VERSION || process.env.npm_package_version || '0.0.0';
const mcVersion = '1.21';
const modLoader = process.env.MOD_LOADER || process.env.npm_package_config_mod_loader || '';
const include = process.env.BUILD_INCLUDE || process.env.npm_package_config_build_include || '';
const distDir = join(root, 'dist');
const workDir = join(root, '.build', nameSafe(`pack-${mcVersion}-${version}`));
const packFormat = '34';
const buildElements = readBuildElements();
const debugLayout = process.env.DEBUG_LAYOUT === '1';
const debugPhase = Number(process.env.DEBUG_PHASE || '0');
const debugOutDir = join(distDir, `debug-${mcVersion}`);

const nameParts = [projectId, buildType, `mc${mcVersion}`, modLoader, version].filter(Boolean);
const fileName = `${nameParts.join('-')}.zip`;
const output = join(distDir, fileName);
const entries = include.split(',').map((entry) => entry.trim()).filter(Boolean);

if (!projectId) throw new Error('Missing build id. Set BUILD_ID or npm package config build_id.');
if (entries.length === 0) throw new Error('Missing build include list. Set BUILD_INCLUDE or npm package config build_include.');

for (const entry of entries) {
  if (!existsSync(join(root, entry))) {
    throw new Error(`Missing required resource pack entry: ${entry}`);
  }
}

mkdirSync(distDir, { recursive: true });
rmSync(output, { force: true });
rmSync(workDir, { recursive: true, force: true });
if (debugLayout) rmSync(debugOutDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

for (const entry of entries) {
  if (entry === 'pack.mcmeta') {
    writePackMeta(join(workDir, entry), packFormat);
  } else {
    cpSync(join(root, entry), join(workDir, entry), { recursive: true });
  }
}

mkdirSync(join(workDir, 'assets'), { recursive: true });

if (debugLayout) {
  exportDebugTree(workDir, debugOutDir);
  const debugLoom = createPng(256, 256);
  paintDebugAtlas(debugLoom, getDebugPhase(debugPhase));
  const debugLoomPath = join(debugOutDir, 'assets', 'minecraft', 'textures', 'gui', 'sprites', 'container', 'loom', 'pattern.png');
  mkdirSync(dirname(debugLoomPath), { recursive: true });
  writePng(debugLoomPath, debugLoom);
}

if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      [
        '$ErrorActionPreference = "Stop"',
        `$zipPath = [System.IO.Path]::GetFullPath("${output.replaceAll('\\', '\\\\').replaceAll('"', '""')}")`,
        'if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }',
        '$null = New-Item -ItemType File -Path $zipPath -Force',
        '$bytes = [byte[]](80,75,5,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)',
        '[System.IO.File]::WriteAllBytes($zipPath, $bytes)',
        '$shell = New-Object -ComObject Shell.Application',
        '$zip = $shell.NameSpace($zipPath)',
        '$src = $shell.NameSpace((Get-Location).Path)',
        '$zip.CopyHere($src.Items(), 16)',
        'Start-Sleep -Seconds 2',
      ].join('; '),
    ],
    { cwd: workDir, stdio: 'inherit' },
  );
  execFileSync(
    'python',
    [
      '-c',
      [
        'import zipfile',
        `zip_path = r"${output}"`,
        'with zipfile.ZipFile(zip_path, "a") as z:',
        '    if "assets/" not in z.namelist():',
        '        info = zipfile.ZipInfo("assets/")',
        '        info.external_attr = 0o40775 << 16',
        '        z.writestr(info, b"")',
      ].join('\n'),
    ],
    { stdio: 'inherit' },
  );
} else {
  execFileSync('zip', ['-r', output, '.'], { cwd: workDir, stdio: 'inherit' });
}

rmSync(workDir, { recursive: true, force: true });

console.log(`Built ${output}`);
console.log(`BUILD_FILE=${fileName}`);

function writePackMeta(destination, format) {
  const mcmeta = {
    pack: {
      pack_format: Number(format),
      supported_formats: [4, 64],
      description: '\u00A7b\u25A0 AE2 GUI - light edition for minecraft\u00A7r\n\u25A0',
    },
  };

  writeFileSync(destination, `${JSON.stringify(mcmeta, null, 2)}\n`);
}

function readBuildElements() {
  const configPath = join(root, 'build.elements.json');
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function getDebugPhase(phase) {
  const checkerboard = {
    cellWidth: 16,
    cellHeight: 16,
    spectrum: true,
    shift: 0,
    accentFromX: 0,
  };
  if (phase <= 0) return { checkerboard };
  return { checkerboard };
}

function exportDebugTree(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  copyTree(srcDir, dstDir);
}

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const sourcePath = join(src, entry);
    const targetPath = join(dst, entry);
    const stats = statSync(sourcePath);
    if (stats.isDirectory()) {
      copyTree(sourcePath, targetPath);
    } else if (stats.isFile()) {
      cpSync(sourcePath, targetPath);
    }
  }
}

function nameSafe(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}
