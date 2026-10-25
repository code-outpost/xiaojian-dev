#!/usr/bin/env node
/**
 * Mochi 构建辅助脚本
 * ------------------------------------------------------------------
 * 项目源码目录含中文，electron-builder 在 Windows 上有两处会因路径/编码出问题：
 *   1) rcedit 无法处理含中文的「输出路径」与「图标输入路径」；
 *   2) electron-builder 用系统 ANSI 代码页派生 rcedit 参数时，中文版本字符串
 *      （FileDescription）会被破坏，导致 rcedit 报 "Unable to commit changes"。
 *
 * 解决策略：
 *   - 产物先输出到纯 ASCII 临时目录（os.tmpdir() 下），绕开中文输出路径；
 *   - 把图标复制到 ASCII 临时路径，并通过 --config.win.icon 指向它；
 *   - 主流程失败时手动调用 rcedit 回退写入图标与版本信息（带重试）；
 *   - 最终把产物复制回项目 dist/ 并统一命名：
 *       dir       → dist/Mochi/（可直接运行的目录）+ dist/Mochi-Folder.zip
 *       portable  → dist/Mochi-Standalone.exe（单文件便携版，直接发给人）
 *       installer → dist/Mochi-Setup-<版本>.exe（安装版：装一次，之后启动最快）
 *
 * 用法（在项目根目录执行）：
 *   node build.mjs dir        # 可运行目录 + zip
 *   node build.mjs installer  # NSIS 安装包
 *   node build.mjs portable   # 单文件便携版
 *   node build.mjs msix       # MSIX/APPX 应用商店包（需 Windows SDK + 证书）
 *   node build.mjs all        # 依次产出 dir + portable + installer
 *
 * 发布到 GitHub Releases（electron-updater 靠它拿更新）：
 *   设置 GH_TOKEN 后执行任意目标即可，产物与 latest.yml 会自动上传。
 *     set GH_TOKEN=ghp_xxxx && node build.mjs all       (cmd)
 *     $env:GH_TOKEN="ghp_xxxx"; node build.mjs all      (PowerShell)
 *
 * Azure 云签名（Azure Trusted Signing）可选，设置以下环境变量后自动启用：
 *   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
 *   AZURE_CODE_SIGN_ACCOUNT / AZURE_CERT_PROFILE / AZURE_ENDPOINT(可选)
 *
 * 代码签名（最后一个环节，必须在所有 exe 改完之后做）：
 *   默认开启。有 build/cert/mochi-dev.pfx（自签占位）就用它，没有则自动生成；
 *   想用真证书：set CERT_PFX=你的.pfx & set CERT_PASSWORD=密码
 *   想关闭签名：set SIGN=0
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { signFiles, certPath, isSelfSigned } from './scripts/sign.mjs';

const mode = process.argv[2] || 'dir';
const projectRoot = process.cwd();
// 每个构建目标使用独立的 ASCII 临时输出目录（rcedit 无法处理中文路径）
let outBase = path.join(os.tmpdir(), 'mochi-dist');
const distDir = path.join(projectRoot, 'dist');
const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;

// 把图标复制到纯 ASCII 临时目录，供 rcedit 读取（绕开中文路径）
const iconSrc = path.join(projectRoot, 'build', 'icon.ico');
const iconTmp = path.join(os.tmpdir(), 'mochi-dist-icon', 'icon.ico');
fs.mkdirSync(path.dirname(iconTmp), { recursive: true });
fs.copyFileSync(iconSrc, iconTmp);

/** 目标名 → electron-builder 的 --win 参数 */
const TARGETS = {
  dir: '--dir',
  portable: '--win=portable',
  installer: '--win=nsis',
  msix: '--win=appx'   // electron-builder 25 没有独立 msix 目标，appx 即 MSIX 家族的商店包
};

/** 是否要把产物发布到 GitHub Releases（electron-updater 读取它做自动更新） */
const GH_TOKEN = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
const DO_PUBLISH = GH_TOKEN && !String(process.env.PUBLISH || '').match(/^0|false$/i);

/** Azure Trusted Signing（云签名，不用买 USB token） */
const AZ = {
  tenantId: process.env.AZURE_TENANT_ID || '',
  clientId: process.env.AZURE_CLIENT_ID || '',
  clientSecret: process.env.AZURE_CLIENT_SECRET || '',
  endpoint: process.env.AZURE_ENDPOINT || 'https://weu.codesigning.azure.net',
  codeSignAccount: process.env.AZURE_CODE_SIGN_ACCOUNT || '',
  certProfile: process.env.AZURE_CERT_PROFILE || ''
};
const DO_AZURE_SIGN = !!(AZ.tenantId && AZ.clientId && AZ.clientSecret && AZ.codeSignAccount && AZ.certProfile);
/**
 * 关键：'all' 必须为每个目标各跑一次 electron-builder。
 * 早期版本只跑一次（--dir），导致 portable/installer 阶段从未构建，
 * dist 下的 Standalone/Setup 一直是上一轮的旧包（不含最新代码）。
 */
const plan = mode === 'all'
  ? ['dir', 'portable', 'installer']
  : [TARGETS[mode] ? mode : 'dir'];

const cli = path.resolve(projectRoot, 'node_modules/electron-builder/cli.js');

// 定位 rcedit（electron-builder 缓存内）。优先使用经验证可用的 winCodeSign-2.6.0 版本，
// 该缓存目录下可能混有损坏/不兼容的其它版本，会报 "Unable to commit changes"。
function findRcedit() {
  const base = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base);
  for (const d of dirs) {
    if (d.includes('2.6.0')) {
      const p = path.join(base, d, 'rcedit-x64.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  for (const d of dirs) {
    const p = path.join(base, d, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 手动写入 exe 资源（图标 + 版本信息），全部使用 ASCII 避免编码问题 */
function manualRcedit(exe) {
  const rc = findRcedit();
  if (!rc) {
    console.warn('[build] 未找到 rcedit，跳过 exe 资源写入（应用仍可运行，仅缺文件图标/版本信息）');
    return false;
  }
  // 在临时副本上操作，写入成功后再覆盖回原 exe；带重试应对偶发文件锁
  const tmp = path.join(os.tmpdir(), 'mochi-exe-tmp.exe');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fs.copyFileSync(exe, tmp);
      execFileSync(rc, [
        tmp,
        '--set-version-string', 'FileDescription', 'Mochi Desktop Pet',
        '--set-version-string', 'ProductName', 'Mochi',
        '--set-version-string', 'LegalCopyright', 'Copyright (C) 2026 Mochi',
        '--set-icon', iconTmp,
      ], { stdio: 'inherit' });
      fs.copyFileSync(tmp, exe);
      fs.rmSync(tmp, { force: true });
      console.log('[build] rcedit 资源写入完成（手动回退）');
      return true;
    } catch (e) {
      console.warn(`[build] 手动 rcedit 第 ${attempt} 次失败：${e.message || e}`);
      sleepSync(800);
    }
  }
  console.warn('[build] 手动 rcedit 多次失败，保留未嵌入图标的 exe（应用仍可用）');
  return false;
}

/* ---------------- 逐个目标构建 ---------------- */
const copied = [];
const skipped = [];

for (const t of plan) {
  outBase = path.join(os.tmpdir(), 'mochi-dist-' + t);
  fs.rmSync(outBase, { recursive: true, force: true });

  const args = [
    cli,
    TARGETS[t],
    `--config.directories.output=${outBase}`,
    `--config.win.icon=${iconTmp}`,
    `--config.nsis.installerIcon=${iconTmp}`,
    `--config.nsis.uninstallerIcon=${iconTmp}`,
  ];

  // 发布到 GitHub Releases（只有 nsis / portable 会产出 latest.yml，dir 不发布）
  if (DO_PUBLISH && (t === 'installer' || t === 'portable')) {
    args.push('--publish=always');
  }

  // Azure 云签名
  if (DO_AZURE_SIGN) {
    args.push(
      `--config.win.azureSignOptions.tenantId=${AZ.tenantId}`,
      `--config.win.azureSignOptions.clientId=${AZ.clientId}`,
      `--config.win.azureSignOptions.clientSecret=${AZ.clientSecret}`,
      `--config.win.azureSignOptions.endpoint=${AZ.endpoint}`,
      `--config.win.azureSignOptions.codeSignAccountName=${AZ.codeSignAccount}`,
      `--config.win.azureSignOptions.certificateProfileName=${AZ.certProfile}`
    );
  }

  console.log(`\n[build] ==== 目标 ${t} → 输出目录: ${outBase} ====${DO_PUBLISH && (t === 'installer' || t === 'portable') ? ' (发布到 GitHub)' : ''}${DO_AZURE_SIGN ? ' (Azure 云签名)' : ''}`);

  let mainOk = true;
  try {
    execFileSync(process.execPath, args, { stdio: 'inherit', cwd: projectRoot });
  } catch (err) {
    mainOk = false;
    console.warn('[build] electron-builder 主流程报错（沙箱内 rcedit 限制常见）：', err.message || err);
  }

  const exe = path.join(outBase, 'win-unpacked', 'Mochi.exe');
  if (fs.existsSync(exe)) {
    if (!mainOk) manualRcedit(exe);
    fixIcon(exe);
  } else if (t !== 'msix') {
    console.error(`[build] 目标 ${t} 未生成 Mochi.exe，跳过该目标。`);
    continue;
  }

/**
 * rcedit 会把 128/256 帧在 GROUP_ICON 里的长度写成「压缩后」的字节数，
 * 而 RT_ICON 里实际仍是原始 BMP，两边不一致 → Windows 取到截断的帧 → 大图标变默认图标。
 * 这里用脚本按真实数据长度回填（幂等）。
 */
function fixIcon(exePath) {
  try {
    execFileSync('D:/Soft/Python/python.exe',
      [path.join(projectRoot, 'scripts', 'fix_exe_icon.py'), exePath],
      { stdio: 'inherit' });
  } catch (e) {
    console.warn('[build] GROUP_ICON 尺寸回填失败：', e.message || e);
  }
}
/* ---------------- 产物整理辅助 ---------------- */
/** 逐个文件复制，允许被占用（正在运行的 Mochi）时跳过而不是整体失败 */
function copyFileWithReport(src, dst) {
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied.push(dst);
    if (/\.exe$/i.test(dst)) fixIcon(dst);
    return true;
  } catch (e) {
    skipped.push(`${dst}（${e.message.split('\n')[0]}）`);
    console.warn(`[build] 跳过 ${dst}: ${e.message.split('\n')[0]}`);
    return false;
  }
}

/** 递归同步目录（同名覆盖） */
function syncDir(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, name);
    const d = path.join(dstDir, name);
    try {
      const st = fs.lstatSync(s);
      if (st.isDirectory()) syncDir(s, d);
      else if (st.isFile()) copyFileWithReport(s, d);
    } catch (e) {
      skipped.push(`${d}（${e.message.split('\n')[0]}）`);
    }
  }
}

  if (t === 'portable') {
    // 单文件便携版
    for (const f of fs.readdirSync(outBase)) {
      if (/\.exe$/i.test(f) && !/^Mochi\.exe$/.test(f)) {
        copyFileWithReport(path.join(outBase, f), path.join(distDir, `Mochi-Standalone.exe`));
      }
    }
  }

  if (t === 'installer') {
    // NSIS 安装版
    for (const f of fs.readdirSync(outBase)) {
      if (/\.exe$/i.test(f) && !/^Mochi\.exe$/.test(f)) {
        copyFileWithReport(path.join(outBase, f), path.join(distDir, `Mochi-Setup-${version}.exe`));
      }
    }
  }

  if (t === 'msix') {
    // 应用商店包（.appx / .msix 同族），提交 Microsoft Store 用这个
    for (const f of fs.readdirSync(outBase)) {
      if (/\.(appx|msix)$/i.test(f)) {
        copyFileWithReport(path.join(outBase, f), path.join(distDir, f));
      }
    }
  }

  if (t === 'dir') {
    syncDir(path.join(outBase, 'win-unpacked'), path.join(distDir, 'Mochi'));
    // 便携 zip（解压即用，适合网盘/邮件转发）
    const zipPath = path.join(distDir, 'Mochi-Folder.zip');
    const py = 'D:/Soft/Python/python.exe';
    const script = `import os,zipfile\nbase=r'''${path.join(outBase, 'win-unpacked')}'''\nout=r'''${zipPath}'''\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:\n  for root,_,files in os.walk(base):\n    for f in files:\n      p=os.path.join(root,f)\n      z.write(p,os.path.relpath(p,base))\nprint('zipped',out)`;
    try {
      execFileSync(py, ['-c', script], { stdio: 'inherit' });
      copied.push(zipPath);
    } catch (e) {
      console.warn('[build] 打包便携 ZIP 失败：', e.message || e);
    }
  }
} // ← 结束目标循环

/* ---------------- 代码签名（必须放在最后：签完再改文件签名就作废） ---------------- */
// Azure 云签名由 electron-builder 在打包时完成，这里不能重复签（会覆盖掉真签名）
const DO_SIGN = !DO_AZURE_SIGN && !String(process.env.SIGN || '1').match(/^0|false$/i);
if (DO_SIGN) {
  const exes = copied.filter(f => /\.exe$/i.test(f) && !/\.(appx|msix)$/i.test(f));
  const dirExe = path.join(distDir, 'Mochi', 'Mochi.exe');
  if (fs.existsSync(dirExe)) exes.push(dirExe);
  if (exes.length) {
    console.log('\n[build] ==== 代码签名 ====');
    console.log(`[build] 证书：${certPath()}${isSelfSigned() ? '（自签占位，别人电脑仍会提示未知发布者）' : ''}`);
    const r = signFiles(exes);
    if (!r.ok) {
      console.warn('[build] ⚠️ 以下文件未签上：' + (r.skipped.join(', ') || r.error || '未知原因'));
      console.warn('   最常见原因是 Mochi 正在运行、exe 被占用，退出后重跑本命令即可补签。');
    }
  }
}

/* ---------------- 产物清单 ---------------- */
console.log('\n[build] 完成 ✔');
console.log(`  可直接运行目录 : ${path.join(distDir, 'Mochi', 'Mochi.exe')}`);
for (const f of fs.readdirSync(distDir)) {
  const full = path.join(distDir, f);
  if (fs.statSync(full).isFile() && /\.(exe|zip|appx|msix)$/i.test(f)) {
    console.log(`  产物           : ${full}  (${(fs.statSync(full).size / 1048576).toFixed(1)} MB)`);
  }
}
if (skipped.length) {
  console.warn('\n[build] ⚠️ 以下文件被占用（通常是 Mochi 正在运行）未能更新：');
  skipped.forEach(s => console.warn('   ' + s));
  console.warn('   请右键托盘 → 退出 Mochi 后重新执行本命令。');
}
