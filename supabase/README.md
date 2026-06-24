# Beyblade X — Vercel + Supabase（做法 B）

場內主機 push 賽程／回放到 Supabase；選手用 **Vercel 固定網址** 查閱（4G、唔同 Wi‑Fi 都得）。

## 1. Supabase

1. 建立專案 → [supabase.com](https://supabase.com)
2. **SQL Editor** 執行 [`schema.sql`](./schema.sql)
3. **Storage** 建立 bucket：`replay-videos`，設為 **Public**
4. **Project Settings → API** 記下：
   - Project URL
   - `anon` public key（俾 Vercel）
   - `service_role` key（**只放主機**，唔好 commit）

## 2. 場內主機（現有專案）

```bash
cp arena-config.example.js arena-config.local.js
```

編輯 `arena-config.local.js`：

```javascript
window.ARENA_CONFIG = {
  eventSlug: 'mie-mie-2026',           // 與 Vercel 環境變數一致
  playerPortalUrl: 'https://xxx.vercel.app',
  supabase: {
    url: 'https://xxxx.supabase.co',
    serviceKey: 'eyJ...service_role...',
  },
};
```

啟動 `./start.sh`。賽程變更同回放結束後會自動 sync 去 Supabase。  
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
  → pushTournamentPayloadToSupabase (arena_state)
  → uploadReplayToSupabase (arena_replays + Storage)

選手 https://xxx.vercel.app
  → Supabase anon 讀取 arena_state / arena_replays
  → 公開 Storage 播片
```

## 安全注意

- `service_role` 只放 `arena-config.local.js`（已 gitignore）
- 選手頁只用 `anon` key；RLS 只開放 **SELECT**
- 勿把 service key 放進 Vercel 或 GitHub

## 疑難排解

| 問題 | 檢查 |
|------|------|
| 雲端無賽程 | 主機有無 `arena-config.local.js`、header 是否顯示「雲端已同步」 |
| 無回放影片 | Storage bucket 是否 public、主機 replay 有無錄到片 |
| Vercel 空白 | `NEXT_PUBLIC_EVENT_SLUG` 是否與主機 `eventSlug` 相同 |
| CORS / 403 | 是否執行 `schema.sql` 的 RLS policies |
