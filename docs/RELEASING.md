# Mochi 发布与上架手册

> 作者：小阿健 · 最后更新：2026-10-25

本文覆盖四件事：① 用 GitHub Releases 发版 + 客户端自动更新；② 官网落地页托管；
③ 打 MSIX 上 Microsoft Store；④ 接云签名消除 SmartScreen 警告。

---

## 0. 一次性准备

| 项目 | 说明 | 费用 |
| --- | --- | --- |
| GitHub 仓库 | 建一个公开仓库 `xiaojian-dev/mochi-desktop-pet` 并推送代码 | 免费 |
| Personal Access Token | GitHub → Settings → Developer settings → Tokens (classic)，勾选 `repo` 全权限 | 免费 |
| 域名（可选） | 如 `getmochi.cn`（`.cn` 需备案）；用 GitHub Pages 可不要域名 | ≈¥30/年 |
| 代码签名证书（强烈建议） | Certum Standard Code Signing 或 Azure Trusted Signing | ≈¥300/年 或按次 |
| Microsoft 合作伙伴账户（上商店才需要） | Partner Center 注册 | 一次性 ≈$19 |

把仓库地址确认到 `package.json`：

```json
"publish": [{ "provider": "github", "owner": "xiaojian-dev", "repo": "mochi-desktop-pet" }]
```

---

## 1. 发一个版本（GitHub Releases + 自动更新）

electron-updater 已经接好：客户端启动 20 秒后检查一次，之后每 6 小时一次；
发现更新静默下载，下完弹窗问「立即重启 / 稍后」。托盘菜单和设置 → 关于 →「检查更新」可手动触发。

### 步骤

1. **改版本号**（必须递增，否则用户端不会提示）：
   `package.json` → `"version": "1.0.1"`
2. **同步官网下载链接**：`website/index.html` 里 `Mochi-Setup-x.y.z.exe` 改成新版本号。
3. **构建并自动上传**：

```bat
:: cmd
set GH_TOKEN=ghp_你的Token
node build.mjs all
```

```powershell
# PowerShell
$env:GH_TOKEN="ghp_你的Token"; node build.mjs all
```

electron-builder 会先打包，再把 `Mochi-Setup-<ver>.exe`、`Mochi-Standalone-<ver>.exe`
和**关键文件 `latest.yml`**（electron-updater 靠它判断是否有新版）一起传到 Release。

4. 到 GitHub 仓库 → Releases，把刚生成的草稿**补全更新日志后点 Publish**。
   > 只要 `latest.yml` 存在，老用户下次启动就会收到更新提示。

### 不发版时

不要设置 `GH_TOKEN`，直接 `node build.mjs all` 即可，只本地出包不上传。

### 常见问题

- **客户端提示「检查更新失败」**：多半是仓库还没有任何 Release，或 Release 是 private。
- **提示已是最新但其实是旧版**：确认 `package.json` 的 version 真的改大了。
- **只想本地验证**：开发模式（`npm start`）不检查更新，这是刻意设计的。

---

## 2. 官网落地页

落地页文件：`website/index.html`（单文件，无依赖，内联 CSS）。

### 托管方式（任选）

- **GitHub Pages**（零成本，最省事）：仓库 Settings → Pages → Source 选 `main` / 根目录或 `/docs`。
  若只想要官网，可把 `website/index.html` 复制成仓库根目录的 `index.html`。
- **Cloudflare Pages / Vercel**：拖拽 `website/` 目录即可，自动分配 `*.pages.dev` 域名，可绑自有域名。
- **国内加速**：把 `Mochi-Setup-*.exe` 同时传到阿里云 OSS / 腾讯 COS + CDN，官网按钮改指 CDN 链接。

### 自定义域名

Pages 面板里填域名 → 到域名服务商加一条 CNAME 记录指向 Pages 提供的地址即可。
`.cn` 域名若解析到国内服务器需 ICP 备案；用 GitHub/Cloudflare 托管通常无需备案。

---

## 3. MSIX（上架 Microsoft Store）

已配置好 `package.json` 的 `appx` 段：

```json
"appx": {
  "identityName": "Ajian.MochiDesktopPet",
  "publisher": "CN=A-Jian",
  "publisherDisplayName": "小阿健",
  "applicationId": "Mochi",
  "displayName": "Mochi 桌面宠物"
}
```

### 构建

```bat
node build.mjs msix
```

产物：`dist/Mochi-MSIX-<ver>.appx`

### 前置条件

1. **Windows 10/11 SDK**（提供 `makeappx.exe`）：Visual Studio Installer 里勾选
   「Windows 10/11 SDK」即可。
2. **签名证书**：MSIX 必须签名才能安装。
   - 商店提交时可用 Partner Center 自动签名的测试证书；
   - 本地验证可用自签证书（`New-SelfSignedCertificate`），但只能在开启开发者模式的机器上安装。
3. `appx.publisher` 的 `CN=` 值**必须与证书的颁发对象完全一致**，否则打包失败。

### 提交流程

Partner Center → 创建新应用 → 保留名称 `Mochi 桌面宠物` → 上传 `.appx` →
填商店描述/截图（可用 `build/shots/` 里的 UI 截图）→ 填隐私政策 URL → 提交审核。
审核通常 1–3 个工作日。

> ⚠️ electron-builder 25 没有独立的 `msix` 目标名，用的是 `appx`（同属 MSIX 家族，商店接受）。
> ⚠️ 沙箱环境没有 Windows SDK，本仓库只保证配置正确，实际打包请在你的开发机上执行。

---

## 4. 代码签名（消除 SmartScreen「未知发布者」）

未签名的 exe 在用户机器上会被 Windows Defender SmartScreen 拦截，这是分发最大的障碍。
两条路：

### 方案 A：Azure Trusted Signing（推荐，纯云端，无 USB token）

已接进 `build.mjs`：设置好环境变量后**自动启用**，无需改代码。

```powershell
$env:AZURE_TENANT_ID="..."
$env:AZURE_CLIENT_ID="..."
$env:AZURE_CLIENT_SECRET="..."
$env:AZURE_CODE_SIGN_ACCOUNT="你的签名账户名"
$env:AZURE_CERT_PROFILE="你的证书配置文件名"
# 可选，默认西欧终结点
$env:AZURE_ENDPOINT="https://weu.codesigning.azure.net"
node build.mjs all
```

准备步骤：Azure 门户 → 创建 **Azure Trusted Signing** 账户 → 建 Certificate Profile →
在 Entra ID 注册应用并授予 `Code Signing Certificate Profile Signer` 角色 → 取上述三个 ID/密钥。

### 方案 B：Certum / Sectigo 证书 + signtool（传统）

拿到 `.pfx` 后，在 `package.json` 的 `build.win` 加：

```json
"win": {
  "certificateFile": "build/cert.pfx",
  "certificatePassword": "你的密码",
  "signingHashAlgorithms": ["sha256"],
  "rfc3161TimeStampServer": "http://time.certum.pl"
}
```

> ⚠️ 不要把 `cert.pfx` 和明文密码提交进 Git。用环境变量或 CI Secrets 注入。

---

## 5. 其它分发渠道（可选补充）

| 渠道 | 做法 | 备注 |
| --- | --- | --- |
| **winget** | 把包放到 GitHub Releases 后，向 `microsoft/winget-pkgs` 提 PR 加 manifest | 免费，审核通过后 `winget install Mochi` |
| **国内软件站** | 360 软件管家 / 腾讯软件中心 / 华为应用市场 PC 版提交 | 免费，审核参差，可能有推广要求 |
| **软著** | 中国版权保护中心申请计算机软件著作权 | 国内上架常被要求，周期约 1–2 个月 |

---

## 6. 发版检查清单

- [ ] `package.json` version 已递增
- [ ] `website/index.html` 下载链接版本号已同步
- [ ] `GH_TOKEN` 已设置 → `node build.mjs all`
- [ ] GitHub Release 已 Publish（含 `latest.yml`）
- [ ] 官网已部署并可下载
- [ ] （可选）MSIX 已上传商店
- [ ] 旧版本客户端能收到更新提示（用一台装着旧版的机器验证一次）
