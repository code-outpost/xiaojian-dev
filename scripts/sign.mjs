#!/usr/bin/env node
/**
 * Mochi 代码签名模块（Windows）
 * ------------------------------------------------------------------
 * 目标：让 dist 下的 exe 带上 Authenticode 数字签名，用户打开属性能看到「发布者」，
 *       SmartScreen 的拦截强度也会下降（自签证书除外，它只用于把流程跑通）。
 *
 * 三种用法：
 *   1) 自签占位（默认，零成本）：
 *        node scripts/sign.mjs --ensure      # 生成 build/cert/mochi-dev.pfx
 *        node scripts/sign.mjs --sign dist/Mochi-Setup-1.0.0.exe
 *      ⚠️ 自签证书不被 Windows 信任，别人电脑上仍会提示「未知发布者」，
 *         仅用于本地验证 / 跑通流水线。真要消除警告见 docs/RELEASING.md 第 4 节。
 *
 *   2) 真证书（Certum / Sectigo / DigiCert 等买的 .pfx）：
 *        set CERT_PFX=D:\cert\my.pfx
 *        set CERT_PASSWORD=xxxxxx
 *        node scripts/sign.mjs --sign dist\Mochi-Standalone.exe
 *
 *   3) 构建时自动签：build.mjs 会在产物定型后调用本模块（SIGN=0 可关闭）。
 *
 * 环境变量：
 *   CERT_PFX          证书路径（默认 build/cert/mochi-dev.pfx 自签）
 *   CERT_PASSWORD     证书密码（自签时默认 mochi-dev）
 *   CERT_SUBJECT      自签证书主题（默认 CN=A-Jian, O=Mochi, C=CN）
 *   CERT_TSA          时间戳服务器（默认 DigiCert）
 *   CERT_TRUST=1      顺便把自签证书装进当前用户的「受信任根」和「受信任发布者」
 *                     （只影响本机，方便自己看签名效果，不会跟随 exe 分发）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = process.cwd();
const DEFAULT_PFX = path.join(projectRoot, 'build', 'cert', 'mochi-dev.pfx');
const DEFAULT_PASSWORD = 'mochi-dev';
const DEFAULT_TSA = process.env.CERT_TSA || 'http://timestamp.digicert.com';
const DEFAULT_SUBJECT = process.env.CERT_SUBJECT || 'CN=A-Jian, O=Mochi, C=CN';

export function certPath() {
  return (process.env.CERT_PFX || '').trim() || DEFAULT_PFX;
}
export function certPassword() {
  return (process.env.CERT_PASSWORD || '').trim() || DEFAULT_PASSWORD;
}
export function isSelfSigned() {
  return certPath() === DEFAULT_PFX;
}

/**
 * 执行一段 PowerShell。参数一律通过 ASCII 临时 JSON 传递，
 * 避免中文路径在命令行编码转换中被破坏（项目目录就含中文）。
 */
function runPs(ps, payload) {
  const tag = 'mochi-sign-' + process.pid + '-' + Date.now();
  const inJson = path.join(os.tmpdir(), tag + '-in.json');
  const outJson = path.join(os.tmpdir(), tag + '-out.json');
  fs.writeFileSync(inJson, JSON.stringify(payload || {}), 'utf8');
  fs.rmSync(outJson, { force: true });

  const script = ps.replace(/__IN__/g, inJson).replace(/__OUT__/g, outJson);
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 300000, windowsHide: true });

  fs.rmSync(inJson, { force: true });
  let data = null;
  if (fs.existsSync(outJson)) {
    try { data = JSON.parse(fs.readFileSync(outJson, 'utf8')); } catch (e) { /* 下面统一处理 */ }
    fs.rmSync(outJson, { force: true });
  }
  if (r.error) return { ok: false, error: r.error.message, stdout: r.stdout, stderr: r.stderr, data };
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || '').trim() || 'PowerShell 返回非零', data };
  if (!data) return { ok: false, error: (r.stderr || r.stdout || '').trim() || 'PowerShell 未输出结果', data };
  return { ok: true, data };
}

/** 生成自签代码签名证书并导出 PFX（已存在则直接复用） */
export function ensureCert({ trust = false } = {}) {
  const pfx = certPath();
  if (fs.existsSync(pfx)) return { ok: true, pfx, reused: true };

  fs.mkdirSync(path.dirname(pfx), { recursive: true });
  const r = runPs(`
$ErrorActionPreference='Stop'
$cfg = Get-Content -LiteralPath '__IN__' -Raw -Encoding UTF8 | ConvertFrom-Json
$pwd = ConvertTo-SecureString -String $cfg.password -Force -AsPlainText
$cert = New-SelfSignedCertificate \`
  -Type CodeSigningCert \`
  -Subject $cfg.subject \`
  -FriendlyName 'Mochi Code Signing (dev)' \`
  -CertStoreLocation 'Cert:\\CurrentUser\\My' \`
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 \`
  -KeyExportPolicy Exportable \`
  -NotAfter (Get-Date).AddYears(3)
Export-PfxCertificate -Cert $cert -FilePath $cfg.pfx -Password $pwd -Force | Out-Null
if ($cfg.trust) {
  foreach ($name in @('Root','TrustedPublisher')) {
    $s = New-Object System.Security.Cryptography.X509Certificates.X509Store($name,'CurrentUser')
    $s.Open('ReadWrite'); $s.Add($cert); $s.Close()
  }
}
$json = @{ ok=$true; subject=$cert.Subject; thumbprint=$cert.Thumbprint; pfx=$cfg.pfx } | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText('__OUT__', $json, (New-Object System.Text.UTF8Encoding($false)))
`, { pfx, password: certPassword(), subject: DEFAULT_SUBJECT, trust: !!trust });

  if (!r.ok) return { ok: false, pfx, error: r.error };
  console.log(`[sign] 已生成自签证书：${r.data.subject}`);
  console.log(`[sign] PFX：${pfx}（密码：${certPassword()}）`);
  return { ok: true, pfx, reused: false, ...r.data };
}

/** 给一批文件签 Authenticode（内部会按需先准备证书） */
export function signFiles(files, { ensure = true, trust = false } = {}) {
  const list = (files || []).filter(f => f && fs.existsSync(f));
  if (!list.length) return { ok: true, signed: [], skipped: [] };

  const pfx = certPath();
  if (ensure && !fs.existsSync(pfx)) {
    const c = ensureCert({ trust });
    if (!c.ok) return { ok: false, signed: [], skipped: list, error: c.error };
  }
  if (!fs.existsSync(pfx)) return { ok: false, signed: [], skipped: list, error: '找不到证书：' + pfx };

  const r = runPs(`
$ErrorActionPreference='Stop'
$cfg = Get-Content -LiteralPath '__IN__' -Raw -Encoding UTF8 | ConvertFrom-Json
$pwd = ConvertTo-SecureString -String $cfg.password -Force -AsPlainText
$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]20
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cfg.pfx, $pwd, $flags)
if (-not $cert.HasPrivateKey) { throw '证书不含私钥，无法签名' }
$out = @()
foreach ($f in $cfg.files) {
  $item = @{ file=$f; ok=$false }
  # 保护：自签模式下若已有别人（真证书/Azure）签的有效签名，绝不覆盖
  if ($cfg.selfSigned) {
    $old = Get-AuthenticodeSignature -LiteralPath $f
    if ($old.Status -eq 'Valid' -and $old.SignerCertificate -and $old.SignerCertificate.Subject -ne $cert.Subject) {
      $item.ok = $true
      $item.status = 'KeepExisting'
      $item.signer = $old.SignerCertificate.Subject
      $item.stamped = $true
      $out += $item
      continue
    }
  }
  try {
    $sig = Set-AuthenticodeSignature -LiteralPath $f -Certificate $cert \`
      -TimestampServer $cfg.tsa -HashAlgorithm SHA256 -IncludeChain 'NotRoot'
    $item.status = $sig.Status.ToString()
    $item.signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
    $item.stamped = if ($sig.TimeStamperCertificate) { $true } else { $false }
    $item.ok = ($sig.Status -ne 'NotSigned')
  } catch {
    $item.status = 'Error'
    $item.error = $_.Exception.Message
  }
  $out += $item
}
$json = @{ ok=$true; subject=$cert.Subject; results=$out } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText('__OUT__', $json, (New-Object System.Text.UTF8Encoding($false)))
`, { pfx, password: certPassword(), tsa: DEFAULT_TSA, selfSigned: isSelfSigned(), files: list.map(f => path.resolve(f)) });

  if (!r.ok) return { ok: false, signed: [], skipped: list, error: r.error };
  const results = r.data.results || [];
  const signed = results.filter(x => x.ok).map(x => x.file);
  const failed = results.filter(x => !x.ok);
  console.log(`[sign] 证书：${r.data.subject}`);
  for (const x of results) {
    const name = path.basename(x.file);
    if (x.ok) {
      const extra = x.status === 'KeepExisting'
        ? '（保留已有真证书签名，未覆盖）'
        : (x.stamped ? '（含时间戳）' : '（无时间戳）');
      console.log(`[sign] ✔ ${name} → ${x.status}${extra}`);
    } else {
      console.warn(`[sign] ✘ ${name} → ${x.status} ${x.error || ''}`);
    }
  }
  return { ok: failed.length === 0, signed, skipped: failed.map(x => x.file), results, selfSigned: isSelfSigned() };
}

/** 把自签证书装进当前用户的「受信任根 / 受信任发布者」，只影响本机显示效果 */
export function trustCert() {
  const pfx = certPath();
  if (!fs.existsSync(pfx)) return { ok: false, error: '证书不存在：' + pfx };
  const r = runPs(`
$ErrorActionPreference='Stop'
$cfg = Get-Content -LiteralPath '__IN__' -Raw -Encoding UTF8 | ConvertFrom-Json
$pwd = ConvertTo-SecureString -String $cfg.password -Force -AsPlainText
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cfg.pfx, $pwd, 20)
foreach ($name in @('Root','TrustedPublisher')) {
  $s = New-Object System.Security.Cryptography.X509Certificates.X509Store($name,'CurrentUser')
  $s.Open('ReadWrite'); $s.Add($cert); $s.Close()
}
$json = @{ ok=$true; subject=$cert.Subject } | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText('__OUT__', $json, (New-Object System.Text.UTF8Encoding($false)))
`, { pfx, password: certPassword() });
  if (!r.ok) return { ok: false, error: r.error };
  console.log(`[sign] 已把「${r.data.subject}」加入当前用户的受信任根（仅本机生效）`);
  return { ok: true };
}

/** 读取某个文件的签名状态（用于自检） */
export function verifyFile(file) {
  const r = runPs(`
$cfg = Get-Content -LiteralPath '__IN__' -Raw -Encoding UTF8 | ConvertFrom-Json
$sig = Get-AuthenticodeSignature -LiteralPath $cfg.file
$json = @{
  status = $sig.Status.ToString()
  signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
  stamped = if ($sig.TimeStamperCertificate) { $true } else { $false }
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText('__OUT__', $json, (New-Object System.Text.UTF8Encoding($false)))
`, { file: path.resolve(file) });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, ...r.data };
}

/* ---------------- CLI ---------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const argv = isMain ? process.argv.slice(2) : [];
if (argv.length) {
  if (argv.includes('--ensure')) {
    const c = ensureCert({ trust: process.env.CERT_TRUST === '1' });
    if (!c.ok) { console.error('[sign] 生成证书失败：', c.error); process.exit(1); }
    console.log(`[sign] 证书就绪 ✔ ${c.pfx}${c.reused ? '（复用已有）' : ''}`);
  }
  if (argv.includes('--sign')) {
    const files = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--sign') continue;
      if (argv[i].startsWith('--')) continue;
      const p = path.resolve(argv[i]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        for (const f of fs.readdirSync(p)) {
          if (/\.exe$/i.test(f)) files.push(path.join(p, f));
        }
      } else {
        files.push(p);
      }
    }
    const r = signFiles(files, { trust: process.env.CERT_TRUST === '1' });
    if (!r.ok) { console.error('[sign] 签名未全部完成：', r.error || r.skipped.join(', ')); process.exit(1); }
    console.log(`[sign] 全部完成 ✔ 共 ${r.signed.length} 个文件`);
  }
  if (argv.includes('--trust')) {
    const t = trustCert();
    if (!t.ok) { console.error('[sign] 信任证书失败：', t.error); process.exit(1); }
  }
  if (argv.includes('--verify')) {
    const files = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--verify') continue;
      if (argv[i].startsWith('--')) continue;
      files.push(path.resolve(argv[i]));
    }
    for (const f of files) {
      const v = verifyFile(f);
      console.log(`[sign] ${path.basename(f)} → ${v.ok ? `${v.status}｜${v.signer || '无发布者'}${v.stamped ? '｜已加时间戳' : ''}` : v.error}`);
    }
  }
  if (!argv.includes('--ensure') && !argv.includes('--sign') && !argv.includes('--trust') && !argv.includes('--verify')) {
    console.log('用法：node scripts/sign.mjs --ensure | --trust | --sign <文件或目录...> | --verify <文件...>');
  }
}
