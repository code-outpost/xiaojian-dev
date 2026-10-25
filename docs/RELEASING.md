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

## 0.1 首次上传到 GitHub（代码已在本地提交好，只差推上去）

本地仓库已经 `git init` 并完成首次提交（分支 `main`），`.gitignore` 已排除
`node_modules/`、`dist/`、自检临时数据等，实际上传约 11MB。

1. 打开 https://github.com/new → Repository name 填 `mochi-desktop-pet` →
   **不要**勾选 "Add a README file"（否则会和本地冲突）→ Create repository。
2. 在本项目根目录（`Mochi/`）执行，把 `你的用户名` 换成实际值：

```bat
git remote add origin https://github.com/你的用户名/mochi-desktop-pet.git
git push -u origin main
```

3. 如果推送时要密码：GitHub 早已不支持账号密码，要用 **Personal Access Token** 当密码
   （Settings → Developer settings → Personal access tokens → Tokens (classic) → 勾 `repo`）。
4. 推完把下面三处的 `xiaojian-dev/mochi-desktop-pet` 改成你自己的仓库：
   - `package.json` → `build.publish.owner` / `repo`
   - `website/index.html` 底部脚本里的 `REPO` 常量（**只此一处**，下载按钮全靠它生成）
   - 本文件的命令示例（无所谓，只是文档）

### 让「下载」真的能下

官网页面的按钮指向 `releases/latest/download/...`，**必须存在一个已发布的 Release 才会生效**。
两条路，任选其一：

**A. 全自动（推荐，配置一次之后每版都省事）**
仓库 Settings → Actions → General → Workflow permissions 选 **Read and write permissions** → Save。
以后只需：改 `version` → `git commit` → `git tag v1.0.1` → `git push origin main --tags`，
`.github/workflows/release.yml` 会自动构建并把安装包 + `latest.yml` 传到 Release。

**B. 手动上传（第一次最直观，5 分钟）**
1. 仓库首页右侧 → **Releases** → **Draft a new release**
2. Tag 填 `v1.0.0`（要和 `package.json` 的 version 对应）→ 标题填 `Mochi v1.0.0`
3. 把 `dist/Mochi-Setup-1.0.0.exe` 和 `dist/Mochi-Standalone.exe` 拖到附件区
4. 点 **Publish release** → 官网按钮立刻可用

### 让官网能打开

Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
推送到 main 后 `.github/workflows/pages.yml` 会自动把 `website/` 发布成
`https://你的用户名.github.io/mochi-desktop-pet/`（首次约 1 分钟生效）。

> ⚠️ 一个隐藏坑：Release 附件名必须和官网链接里的文件名**完全一致**。
> 安装版是 `Mochi-Setup-<版本>.exe`（带版本号），便携版固定叫 `Mochi-Standalone.exe`（不带版本号），
> 这是特意设计的——便携版名字永久稳定，老链接不会失效。

---

## 1. 发一个版本（GitHub Releases + 自动更新）

electron-updater 已经接好：客户端启动 20 秒后检查一次，之后每 6 小时一次；
发现更新静默下载，下完弹窗问「立即重启 / 稍后」。托盘菜单和设置 → 关于 →「检查更新」可手动触发。

### 步骤

1. **改版本号**（必须递增，否则用户端不会提示）：
   `package.json` → `"version": "1.0.1"`
2. **同步官网版本号**：`website/index.html` 底部脚本的 `VERSION` 常量改成新版本号
   （只需改这一处，下载按钮全部由它生成）。
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

electron-builder 会先打包，再把 `Mochi-Setup-<ver>.exe`、`Mochi-Standalone.exe`
和**关键文件 `latest.yml`**（electron-updater 靠它判断是否有新版）一起传到 Release。
> 便携版故意不带版本号，这样官网/网盘上的旧链接永远不会失效。
> 同时会生成 `Mochi-Setup-<ver>.exe.blockmap`，它配合 latest.yml 实现**增量下载**，别删。

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
三条路，从"零成本先把流程跑通"到"彻底消除警告"：

### 方案 0：自签占位（**已内置，默认开启**）

`scripts/sign.mjs` 已经接进 `build.mjs`，构建完自动签，`node build.mjs all` 一条命令到底。

```bat
:: 仅生成证书（默认落在 build\cert\mochi-dev.pfx，密码 mochi-dev）
node scripts/sign.mjs --ensure

:: 把自签证书装进「当前用户 → 受信任根 / 受信任发布者」，本机就能看到"签名已通过验证"
set CERT_TRUST=1
node scripts/sign.mjs --trust

:: 单独签 / 单独验
node scripts/sign.mjs --sign dist\Mochi-Standalone.exe
node scripts/sign.mjs --verify dist\Mochi-Standalone.exe
```

- 签名带 **RFC3161 时间戳**（DigiCert），证书过期后签名依然有效。
- ⚠️ **局限**：自签证书不在 Windows 信任库里，别人电脑上仍然会提示"未知发布者"。
  它的价值是把签名流水线跑通（发布者字段、时间戳、构建集成全部验证过），
  等你拿到真证书，只需设 `CERT_PFX` / `CERT_PASSWORD` 两个环境变量重新构建即可，代码一行不用改。
- ⚠️ `*.pfx` 已在 `.gitignore` 里，不会误提交。

#### 自签与自动更新：必须知道的验签策略

`electron-updater` 默认的验签要求安装包证书**整条链被系统信任**
（`Get-AuthenticodeSignature` 的 `Status` 必须是 `Valid`）。自签证书在任何用户机器上都不满足，
表现是：**下载到 100% 后立刻被判失败**，报
`New version x is not signed by the application owner`，用户只看到"正在悄悄下载"却永远装不上。

因此 `main.js` 的 `applyUpdaterPolicies()` 把验签换成**宽松但保留身份校验**的实现：

| 检查项 | 默认策略 | 我们的策略 |
| --- | --- | --- |
| exe 是否带 Authenticode 签名 | 要求 | 要求（无签名照样拒绝） |
| 证书链是否被系统信任 | 要求 | **不要求** |
| 签名主体 CN 是否等于 `publisherName` | 要求 | 要求（`app-update.yml` 里是 `A-Jian`） |
| latest.yml 里的 sha512 | 校验 | 校验（防篡改仍有保障） |

换成真证书（Azure / OV / EV）后这段**无需改动**，真证书同样满足上述条件。

> ⚠️ **v1.0.1 / v1.0.2 的包已固化旧逻辑，无法自动升级到修复后的版本**，
> 用户需要手动下载安装一次，之后的版本更新才能全自动。

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
- [ ] `website/index.html` 的 `VERSION` 常量已同步
- [ ] `GH_TOKEN` 已设置 → `node build.mjs all`
- [ ] GitHub Release 已 Publish（含 `latest.yml`）
- [ ] 官网已部署并可下载
- [ ] （可选）MSIX 已上传商店
- [ ] 旧版本客户端能收到更新提示（用一台装着旧版的机器验证一次）
