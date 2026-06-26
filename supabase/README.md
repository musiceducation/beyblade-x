# Beyblade X — Vercel + Supabase（做法 B）

場內主機 push 賽程／回放到 Supabase；選手用 **Vercel 固定網址** 查閱（4G、唔同 Wi‑Fi 都得）。

## 1. Supabase

1. 建立專案 → [supabase.com](https://supabase.com)
2. **SQL Editor** 執行 [`schema.sql`](./schema.sql)
3. **Storage** 建立 bucket：`replay-videos`，設為 **Public**
4. **Project Settings → API** 記下：
   - Project URL
   - `anon` public key（俾 Vercel）
   - `service_role` / secret key（**只放主機** `arena-secrets.local.json`，唔好 commit）

## 2. 場內主機（現有專案）

```bash
cp arena-config.example.js arena-config.local.js
cp arena-secrets.example.json arena-secrets.local.json
```

編輯 `arena-config.local.js`（瀏覽器可見，只放公開設定）：

```javascript
window.ARENA_CONFIG = {
  eventSlug: 'mie-mie-2026',
  playerPortalUrl: 'https://xxx.vercel.app',
  supabase: { url: 'https://xxxx.supabase.co' },
};
```

編輯 `arena-secrets.local.json`（**只俾 serve-https.py 讀**，唔會送到瀏覽器）：

```json
{
  "eventSlug": "mie-mie-2026",
  "supabaseUrl": "https://xxxx.supabase.co",
  "supabaseServiceKey": "sb_secret_..."
}
```

啟動 `"./start.sh"`（路徑含空格時請加引號）。賽程變更同回放結束後會經本機 `/cloud/*` 代理 sync 去 Supabase。  
「選手·賽程」分頁 QR 會用 `playerPortalUrl`（有設定時）。

## 3. Vercel（cloud-player）

```bash
cd cloud-player
cp .env.example .env.local
# 填 NEXT_PUBLIC_SUPABASE_URL、ANON_KEY、EVENT_SLUG
npm install
npm run build
```

部署：

```bash
npx vercel --prod
```

或在 Vercel Dashboard：

- Root Directory: `cloud-player`
- Environment variables（同 `.env.example`）

## 4. 資料流

```
主機 index.html
  → POST /cloud/tournament.json (serve-https.py)
  → POST /cloud/replay/* (serve-https.py)
  → Supabase arena_state / arena_replays + Storage

選手 https://xxx.vercel.app
  → Supabase anon 讀取 arena_state / arena_replays
  → 公開 Storage 播片
```

## 安全注意

- `supabaseServiceKey` 只放 `arena-secrets.local.json`（已 gitignore）
- 瀏覽器 **唔會** 直接 call Supabase with secret key
- 選手頁只用 `anon` key；RLS 只開放 **SELECT**
- 勿把 service key 放進 Vercel 或 GitHub

## 疑難排解

| 問題 | 檢查 |
|------|------|
| 雲端無賽程 | 有無 `arena-secrets.local.json`、重啟 `./start.sh`、`/cloud/status.json` 是否 `ok: true` |
| 401 secret key in browser | 從 `arena-config.local.js` 移除 `serviceKey`，改用 `arena-secrets.local.json` |
| 無回放影片 | Storage bucket 是否 public、主機 replay 有無錄到片 |
| Vercel 空白 | `NEXT_PUBLIC_EVENT_SLUG` 是否與主機 `eventSlug` 相同 |
| permission denied | 執行 [`grants-fix.sql`](./grants-fix.sql) |
