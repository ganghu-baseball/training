# Claude Code 環境設定

這四個工具性質不同，不是同一種東西，安裝位置也不同。

| 名稱 | 實際是什麼 | 裝在哪 | 本 repo 狀態 |
|---|---|---|---|
| frontend-design | Agent Skill（Anthropic 官方） | repo 或機器 | ✅ 已隨 repo 提供 |
| playwright | MCP server（Microsoft） | repo 或機器 | ✅ 已隨 repo 提供 |
| claude-mem | Claude Code plugin（第三方） | 你的機器 | ⬜ 需自行安裝 |
| OmniRoute | 本機 API gateway（第三方） | 你的機器 | ⬜ 需自行安裝，見下方注意事項 |

---

## 已隨 repo 設定好（clone 下來就有）

### frontend-design
`.claude/skills/frontend-design/` — Anthropic 官方 skill，Apache 2.0，直接 vendor 進來。
好處是 Claude Code 網頁版 session 也吃得到（網頁版不會帶你本機的 plugin）。
細節見 `.claude/skills/frontend-design/ORIGIN.md`。

### playwright
`.mcp.json` — 專案層級的 MCP server 設定。開啟這個 repo 時 Claude Code 會提示你信任並載入。

本機第一次使用前需要下載瀏覽器：

    npx playwright install chromium

想看到瀏覽器實際跳出來（預設是 headless），把 `.mcp.json` 裡的 `--headless` 拿掉即可。

---

## 需要你在自己電腦上裝（我在雲端 session 裡裝不到）

### claude-mem
跨 session 記憶。在你自己的 Claude Code CLI 裡輸入：

    /plugin marketplace add thedotmack/claude-mem
    /plugin install claude-mem

裝完重開 Claude Code。它靠 hooks 攔截每次 session，會把你的 transcript 存到本機。

### OmniRoute
本機 AI gateway，把 `ANTHROPIC_BASE_URL` 指向 localhost，用量滿了自動改用其他家模型。
安裝方式見 https://github.com/diegosouzapw/OmniRoute

**先了解它的取捨再決定裝不裝：**

- 它的運作方式是讓 Claude Code 不再直接連 Anthropic。fallback 觸發時，你的
  程式碼和 prompt 會送到它路由到的那家 provider（OpenAI / Google / DeepSeek 等），
  不是留在本機。
- provider 憑證存在本機 SQLite。
- 有已公開的漏洞紀錄（CVE-2026-49352），裝之前建議確認你用的版本已修補。
- 它變成單點故障：gateway 沒跑，Claude Code 就不能用。
- 「免費 token」來自各家 provider 的共用免費額度，是被 rate limit 的共享池。

如果你有 Claude 訂閱，接上去之後「不斷線」的代價是換成別家模型在跑，不是繼續用 Claude。
這是產品體驗上的取捨，值不值得由你判斷。

---

## 實測備註

`.mcp.json` 的設定以「你本機使用」為準。已在雲端容器實測 Chromium 能正常
開啟並截圖本 repo 的 `index.html`。

若在 Claude Code 網頁版 session 中遇到 Playwright 找不到瀏覽器，是因為容器
預裝的 Chromium 版本與 `@playwright/mcp@latest` 期望的版本號不一致。該環境
已預裝瀏覽器，不要執行 `playwright install`，改為在啟動參數加上：

    --executable-path /opt/pw-browsers/chromium

這個路徑只存在於雲端容器，所以沒有寫進 `.mcp.json`，以免影響本機使用。
