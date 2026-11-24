# Sona — 介面合約

本機 AI 音樂與聲音 app。Mac（Apple Silicon）＋ Windows（NVIDIA 優先）。三個部分，各自擁有自己的資料夾，只透過本文件定義的介面溝通。改合約要先改這份文件。

| 部分 | 資料夾 | 技術 |
|---|---|---|
| 後端 | `backend/` | Python 3.11，FastAPI＋uvicorn，`uv` 管理 |
| 介面 | `frontend/` | Vite＋React＋TypeScript |
| 外殼 | `electron/` | Electron，打包 electron-builder |

## 功能

1. **寫歌**（YuE2）：風格標籤＋歌詞 → 有人聲的歌。模式 `full`（寫旋律＋和弦再生成，預設）、`melody`、`off`（直接生成）。
2. **純音樂**（YuE2 instrumental）：風格描述 → 無人聲。做法照 YuE repo `skills/yue2-music/instrumental`：先規劃譜、把 Vocal 音符移到 Ins、再用固定 ABC 生成。該資料夾 MIT 授權，可 vendor。
3. **翻唱**（SheetSage2＋YuE2）：上傳一首歌 → 轉旋律譜 → 用新風格（可換歌詞）重新生成；或做純音樂 cover。
4. **拆軌**（Demucs htdemucs / htdemucs_ft）：一首歌 → vocals / drums / bass / other。
5. **聲音複製**（Fish Audio Drama 3）：參考錄音＋逐字稿 → 用該聲音念指定文字。後端二選一：
   - `local`：`mlx-community/fish-audio-drama-3-4bit` 走 mlx-audio（目前要裝 `git+https://github.com/stickerdaniel/mlx-audio@fish-drama3`）。只有 Apple Silicon 且記憶體 ≥ 32GB 才開放。峰值約 26GB。
   - `api`：Fish Audio 官方 API，`POST https://api.fish.audio/v1/tts`，header `model: drama-3`（拼錯會默默退回 s2.1-pro），使用者自己填 API key。
   - 不得把請求轉到我們自己的伺服器（授權禁止把 Drama 3 當服務提供給他人）。

## 執行模型

- Electron 在第一次啟動時用內附的 `uv` 執行 `uv run --project <backend>` 啟動後端（uv 會自動下載 Python 與核心依賴）。
- 後端核心 venv 只裝 FastAPI、huggingface_hub、PyAV（mp3 編解碼，內含 FFmpeg）這類輕量依賴。**每個引擎一個獨立 venv**（依賴互相衝突：yue2-infer 釘死 torch 2.10／transformers 4.57.6），由後端用 `uv` 在資料目錄下建立：`envs/yue2`（yue2-infer 不在 PyPI，裝 GitHub release `yue2-v0.1.6` wheel）、`envs/demucs`（Demucs＋SheetSage2，兩者都要 torch 2.8，所以翻唱的轉譜也在這個 env）、`envs/voice-mlx`。
- 引擎以**子行程**執行（engine venv 的 python 跑 `backend/sona_backend/workers/<engine>.py`），stdout 每行一個 JSON 事件回報進度。子行程結束即釋放記憶體。
- **同一時間只有一個引擎常駐**。切換引擎前先結束前一個 worker。voice worker 可常駐（閒置 5 分鐘自動結束）以免每句重載模型；一次只載一個語音模型，換模型先釋放（Drama 3 約 22GB）。
- 任務佇列單一併發，依序執行。
- 模型權重用 huggingface_hub 預設 cache（`HF_HOME`，未設定即 `~/.cache/huggingface`），已下載的直接沿用。
- 開發與測試用 `SONA_FAKE_ENGINES=1`：所有引擎改成假 worker，幾秒內產生正弦波音檔並照真實階段回報進度。模型／環境狀態也要能假裝成 ready。

### 平台預設

| | Mac Apple Silicon | Windows NVIDIA | 其他 |
|---|---|---|---|
| YuE2 | `device=mps`, `backend=torch-eager`, `memory_budget_gib=12` | `device=cuda`, `backend=torch` | `cpu`（標示極慢） |
| Demucs | mps | cuda | cpu |
| Voice | local（≥32GB）或 api | 只有 api | 只有 api |

## 目錄

- 資料目錄 `DATA`：Mac `~/Library/Application Support/Sona`，Windows `%APPDATA%\Sona`。放 `envs/`、`settings.json`、`db.sqlite`、`uploads/`、`voices/`。
- 作品目錄（可在設定改）：預設 `~/Music/Sona/<作品標題-短id>/`，裡面是 `audio.mp3`、`audio.flac`、`stems/*.wav`、`score.abc`、`request.json`。

## Electron preload

`window.sona = { apiBase: "http://127.0.0.1:<port>", token, platform /* process.platform：darwin｜win32 */, openExternal(url), pickFile(filters) /* 回傳路徑字串 */, pickFolder(defaultPath) /* 選資料夾，取消回 null */ }`。介面判斷平台一律看 `/system`，不看這裡的 platform。上傳檔案用 `<input type=file>`。後端 CORS 放行 `http://localhost:5173`、`null`（file://）、`app://`。

## 後端啟動

Electron spawn 後端時 stdin 必須是 pipe 且保持開著（後端看到 stdin EOF 就退出）。建議環境變數 `UV_PYTHON_PREFERENCE=only-managed`。`file://` 載入的請求帶 `Origin: null`，後端已放行。

後端啟動後在 stdout 印一行：

```
SONA_READY {"port": 51234, "token": "<random>"}
```

綁 `127.0.0.1`，隨機 port。除 `/api/health` 外每個請求要帶 `Authorization: Bearer <token>`；`<audio>` 與 SSE 用不了 header，所以也接受 query `?token=`。

## HTTP API

全部 JSON，前綴 `/api`。錯誤回 `{"error": {"code": "...", "message": "..."}}`，message 是可直接顯示給使用者的中文。

### 系統

- `GET /health` → `{ok: true, version}`
- `GET /system` →
  ```ts
  { platform: "mac"|"windows"|"linux", arch: string, ram_gb: number,
    accelerator: { kind: "mps"|"cuda"|"cpu", name: string, vram_gb: number|null },
    capabilities: { song: Cap, instrumental: Cap, cover: Cap, stems: Cap, voice_local: Cap, voice_hq: Cap, voice_api: Cap },
    ai_tools: { claude: boolean, codex: boolean },   // 本機有沒有 Claude Code／Codex CLI（修飾語氣用）
    music_dir: string }
  type Cap = { available: boolean, reason?: string, speed_hint?: string }  // 例 speed_hint: "約每分鐘生成 10 秒音樂"
  ```

### 安裝（引擎環境＋模型）

一個「元件」= 一個 venv 或一個模型。介面只看元件清單畫安裝精靈。

- `GET /components` → `Component[]`
  ```ts
  { id: string,                       // "env:yue2" | "env:demucs" | "env:voice-mlx" | "model:yue2-3b" | "model:yue2-vae" | "model:sheetsage2" | "model:htdemucs" | "model:htdemucs-ft" | "model:drama3-mlx" | "model:qwen3-tts" | "model:qwen3-asr"
    kind: "env"|"model", name: string, description: string,
    size_bytes: number, done_bytes: number,
    state: "missing"|"queued"|"installing"|"ready"|"error"|"unsupported",
    error?: string,
    needed_for: ("song"|"instrumental"|"cover"|"stems"|"voice_local"|"voice_hq")[] }
  // env:demucs 的 needed_for 含 stems 與 cover；model:sheetsage2 同時包含 MERT-v2-FullSong，刪除時兩個 repo 一起刪
  ```
- `POST /components/{id}/install`（重複呼叫無害）、`POST /components/{id}/cancel`、`DELETE /components/{id}`（刪模型或 venv）
- `POST /features/{feature}/install` → 一次排入該功能需要的所有元件。

### 任務

- `POST /jobs` body `{type, params}` → `Job`
  ```ts
  type JobType = "song"|"instrumental"|"cover"|"stems"|"voice"
  // params
  song:         { title?: string, style: string, lyrics: string, mode?: "full"|"melody"|"off", seed?: number }
  instrumental: { title?: string, style: string, seed?: number }
  cover:        { title?: string, upload_id: string, style: string, lyrics?: string, instrumental?: boolean, seed?: number }
  stems:        { title?: string, upload_id?: string, track_id?: string, model?: "htdemucs"|"htdemucs_ft" }
  voice:        { voice_id: string, text: string, backend?: "local"|"api", quality?: "fast"|"high" }   // 本機 fast＝Qwen3-TTS（預設，voice_local，16GB+），high＝Drama 3（voice_hq，32GB+）

  type Job = { id: string, type: JobType, params: object, title: string,
    state: "queued"|"running"|"done"|"failed"|"cancelled",
    stage: string,              // 中文，直接顯示，例「規劃旋律」「生成聲音」「合成音訊」「載入模型」
    progress: number,           // 0..1，未知時 -1
    eta_seconds: number|null,
    created_at: string, started_at: string|null, finished_at: string|null,
    error?: string, track_id?: string, queue_position?: number }
  ```
  - `cover` 沒有 lyrics 又沒開 instrumental → 400 `invalid_params`。`voice` 沒有 title，標題取文字前 30 字。
  - `progress` 在「規劃旋律」階段是 -1（無法預估）。`eta_seconds` 只估目前階段。
  - 錯誤狀態碼：400 參數錯、401 token、404、409（元件安裝中不能刪）、422 請求格式錯。
- `GET /jobs` → `Job[]`（新到舊）、`GET /jobs/{id}`、`POST /jobs/{id}/cancel`、`DELETE /jobs/{id}`

### 作品

- `GET /tracks` → `Track[]`、`GET /tracks/{id}`、`PATCH /tracks/{id}` `{title?, liked?}`、`DELETE /tracks/{id}`
  ```ts
  type Track = { id: string, title: string, kind: "song"|"instrumental"|"cover"|"stems"|"voice",
    created_at: string, duration_s: number, style?: string, lyrics?: string, text?: string,
    params: object, liked: boolean,
    hue: number,                // 0..360，封面漸層的主色，後端生成時隨機決定並存起來
    audio_url: string,          // 相對路徑，例 "/api/tracks/abc/audio"
    stems?: { name: "vocals"|"drums"|"bass"|"other", url: string }[],
    score_abc?: string, folder: string }
  ```
- `GET /tracks/{id}/audio`（支援 Range）、`GET /tracks/{id}/stems/{name}`、`POST /tracks/{id}/reveal`（在 Finder／檔案總管顯示）

### 上傳與聲音

- `POST /uploads` multipart `file` → `{upload_id, filename, duration_s}`（mp3/wav/flac/m4a）
- `POST /polish` `{text, tool?: "claude"|"codex"}` → `{text, tool}`：用使用者本機的 Claude Code／Codex CLI 把要念的文字改得更有語氣（不需 API key）；都沒裝 → 400 `no_ai_cli`
- `GET /voices` → `Voice[]`，`POST /voices` multipart `name, file`（`transcript` 選填；留空時第一次生成語音會自動辨識參考錄音並存回），`DELETE /voices/{id}`，`GET /voices/{id}/sample`。第一次啟動、聲音列表是空的時候，後端放一個內建範例聲音（`sample: true`，前端顯示翻譯過的名稱）；刪掉就不會再放
  ```ts
  type Voice = { id: string, name: string, transcript: string, duration_s: number, created_at: string, sample_url: string }
  ```
  參考錄音建議 10–30 秒，太長由後端截斷。

### 設定

- `GET /settings`、`PUT /settings`（部分更新）
  ```ts
  { music_dir: string, voice_backend: "local"|"api", fish_api_key_set: boolean, fish_api_key?: string /* 只寫不讀 */,
    language: "zh-TW"|"en" }
  ```

### 事件串流

`GET /events`（SSE）。每個事件 `event: <type>`，`data:` 是 JSON：

- `job` → 完整 `Job`（任何欄位變動就送）
- `component` → 完整 `Component`
- `track` → `{action: "created"|"updated"|"deleted", track: Track}`
- `engine` → `{engine: "yue2"|"demucs"|"voice-mlx"|null, state: "loading"|"ready"|"unloading"|"idle"}`

連線時先送一次所有進行中的 job、component 與 engine 現況。`track created` 會比 `job done` 先到；`DELETE /jobs/{id}` 不發事件。

## 介面要點

- 參考 Suno（建立頁：簡單／自訂模式、風格標籤、歌詞、純音樂開關；作品列表）與 Spotify（底部常駐播放列、深色、大封面）。
- 第一次開啟是安裝精靈：依 `/system` 顯示這台電腦能用哪些功能、各要下載多少，使用者勾選後一鍵安裝。
- 生成要很久（Mac 上一首 3 分鐘的歌約 18 分鐘）：佇列與進度要一直看得到，可以關掉頁面去做別的事。
