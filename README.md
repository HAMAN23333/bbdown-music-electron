# BBDown UI 音乐批量下载器

一个本地 Web UI 工具：批量输入多个歌名，自动在 B 站检索并下载音频。

当前版本完成了两项核心改造：

- 搜索链路按 `Nemo2011/bilibili-api` 的 `search.py` 思路重构（`web_search_by_type` + `web_search`，并支持 `order/duration/tids/pubtime` 参数）
- `BBDown` 固定从项目目录 `tools/bbdown/BBDown.exe` 启动，不依赖系统全局 `BBDown`
- 下载后支持调用项目内置 `FFmpeg` 转码为 `mp3/m4a/aac/flac/wav/ogg/opus`，并可设置比特率

## 功能

- 多行输入歌名（每行一首）
- 调用 WBI 搜索接口，支持排序/时长/分区/发布时间筛选
- 对候选结果做评分后自动选择最优视频（非简单取第一条）
- 调用 `BBDown --audio-only` 批量下载音频
- 下载后自动转码，支持 `mp3` 等输出格式及可配置比特率
- 支持并发下载、任务进度和实时日志
- 支持自定义下载目录（默认用户主目录）
- 支持三种 Cookie 方式：内置登录窗口扫码、内置登录窗口账号密码、手动粘贴

## 环境要求

- Windows 10/11 x64
- Node.js 18+（当前代码无第三方依赖）
- PowerShell 5.1+（用于下载 BBDown / FFmpeg 与打包 Electron）
- 首次使用需执行 `scripts/setup-bbdown.ps1` 下载项目内置 `BBDown.exe`
- 首次使用需执行 `scripts/setup-ffmpeg.ps1` 下载项目内置 `ffmpeg.exe`

## 启动

在项目目录执行：

```powershell
node server.js
```

看到如下输出表示启动成功：

```text
[bbdown-ui] running on http://127.0.0.1:5050
```

浏览器访问：

`http://127.0.0.1:5050`

可先验证健康接口：

```powershell
Invoke-RestMethod http://127.0.0.1:5050/api/health
```

如果 `bundledBbdownReady` 为 `false`，执行（脚本会对下载包做 SHA256 校验）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-bbdown.ps1
```

如果 `bundledFfmpegReady` 为 `false`，执行（脚本会对下载包做 SHA256 校验）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-ffmpeg.ps1
```

## 使用步骤

1. 在“歌名列表”中每行输入一首歌名。  
2. 设置下载目录（默认用户主目录，可手填或点击“选择”按钮）。  
3. 选择输出格式（如 `mp3`）和比特率（64-320kbps；`flac/wav/original` 会忽略比特率）。  
4. 如需会员内容：  
   - 点击“内置登录（扫码/账号密码）”，在 Electron 内置窗口完成登录后自动回填 Cookie；或  
   - 手动粘贴 Cookie 到输入框。  
5. 视需要设置搜索参数（排序、时长、tid、发布时间、候选上限）。  
6. 点击“开始批量下载”。  
7. 在右侧查看每首歌的状态、命中 BVID、评分和日志。  

## 说明

- 搜索接口对齐 `bilibili-api`：
  - `wbi/search/type`（对应 `search_by_type`）
  - `wbi/search/all/v2`（对应 `search` 回退）
- `timeRange` 的 `duration` 映射逻辑与上游一致：
  - `<=0 -> 0`
  - `0-10 -> 1`
  - `10-30 -> 2`
  - `30-60 -> 3`
  - `>60 -> 4`
- 会员或版权限制内容可能需要 Cookie（在页面输入框填写）。  
- 程序会为 BBDown 子进程清理代理变量（`ALL_PROXY/HTTP_PROXY/HTTPS_PROXY`），避免本地代理配置导致连接异常。  
- 程序会将每首歌先下载到任务临时目录，再搬运或转码到目标下载目录。  
- 转码通过项目内置 `tools/ffmpeg/ffmpeg.exe` 执行，不调用系统 PATH 中的 ffmpeg。  
- 当前后端只调用项目内置 `tools/bbdown/BBDown.exe`，不会调用系统路径下的 BBDown。  
- `scripts/setup-bbdown.ps1`、`scripts/setup-ffmpeg.ps1` 与 `scripts/build-electron-portable.ps1` 默认会校验 GitHub release 资产 SHA256（来自 release asset digest）。  

## 常见问题

1. 提示“项目内置 BBDown 不存在”  
   - 运行：`powershell -ExecutionPolicy Bypass -File .\scripts\setup-bbdown.ps1`

2. 提示“项目内置 FFmpeg 不存在”  
   - 运行：`powershell -ExecutionPolicy Bypass -File .\scripts\setup-ffmpeg.ps1`

3. 下载失败 / 命中内容不对  
   - 更精确地输入关键词（歌名 + 歌手），如 `晴天 周杰伦`。  
   - 如果需要会员内容，填入有效 Cookie。  
   - 可尝试把“搜索排序”改为 `pubdate`，或设置 `tid=3`（音乐分区）。  

4. 端口冲突  
   - 修改 `server.js` 中的 `PORT` 值。  

## Electron 本地 App 打包（不调用本机浏览器）

当前桌面端方案选用 **Electron**（不选 Tauri），原因是 Electron 自带 Chromium 渲染，不依赖系统浏览器或系统 WebView。

打包命令（Windows x64）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-electron-portable.ps1
```

说明：

- 打包前请先准备内置工具：`setup-bbdown.ps1` + `setup-ffmpeg.ps1`
- 打包脚本会校验 Electron 压缩包 SHA256（来自 GitHub release asset digest），校验失败会终止打包。

默认产物：

- 文件夹：`dist\BBDownMusicApp-electron`
- 压缩包：`dist\BBDownMusicApp-electron-win64-portable.zip`

使用方式：

1. 解压 `BBDownMusicApp-electron-win64-portable.zip`
2. 双击 `BBDownMusicApp.exe`
3. 应用在 Electron 内置窗口运行，不会调用本机浏览器
