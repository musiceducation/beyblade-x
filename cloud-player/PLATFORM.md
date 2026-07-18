# 比賽平台（開房／入房／計分合體）

開房 + 名單 + 抽籤賽程 + **對戰計分**（殘存／爆裂／擊飛／極致）+ 直播畫面；**不需 Mac** 也可完整跑。Mac 本機計分台可選接同一房號同步。

**產品方向**：**BEYBATTLE**（App Store 統一 App，含相機／回放）— 見 [`APP-STORE.md`](./APP-STORE.md)。

## 設定

1. 在 Supabase SQL Editor 執行：
   - [`supabase/schema-rooms.sql`](../supabase/schema-rooms.sql)
   - [`supabase/schema-room-replays.sql`](../supabase/schema-room-replays.sql)（BEYBATTLE 回放）
2. `cloud-player/.env.local` 填入（見 `.env.example`）：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（只放伺服器）
   - `ROOM_TOKEN_SECRET`
3. `cd cloud-player && npm run dev`

## 使用（單一站）

1. **開房（裁判）**：Lobby → 設裁判密碼 → 建立房間  
2. 自動進入「**對戰計分**」：選場 → 殘存／爆裂／擊飛／極致  
3. 「**裁判**」分頁：加選手、抽籤  
4. 玩家入房號看即時／賽程／成績  
5. 「直播畫面」或 `/live/房號?session=junior` 給 OBS  

## 本機計分台（可選）

1. `arena-config.local.js` 設 `playerPortalUrl` 或 `roomsApiBase` 為平台網址（例如 `http://localhost:3000`）  
2. 房間頁「開啟本機計分台」，或本機按 ☁ 輸入房號＋裁判密碼  
3. 本機計分會 `set_live_scores` / `record_winner` 推到同一雲端房  

Deep link 範例：

`https://localhost:8443/?platformRoom=房號&refereeToken=TOKEN&roomsApi=http://localhost:3000`

## 舊版

- 舊版單活動 Portal：`?legacy=1`
