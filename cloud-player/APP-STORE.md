# BEYBATTLE — 統一 App（App Store）

上架名：**BEYBATTLE**  
實作：`mobile/` · Canvas：`app-store-product`

## 設定（一次性）

1. Supabase SQL（順序）：
   - [`schema-rooms.sql`](../supabase/schema-rooms.sql)
   - [`schema-room-replays.sql`](../supabase/schema-room-replays.sql)
   - Storage bucket `replay-videos`（public read）
2. `cloud-player/.env.local` — Supabase + `ROOM_TOKEN_SECRET`
3. `mobile/.env` — `EXPO_PUBLIC_API_BASE`（真機用 Mac LAN IP）

## 功能

| 分頁 | 內容 |
|------|------|
| 計分 | 4 種 Finish → rooms API |
| 鏡頭 | 錄製 → **自動上傳** Supabase |
| 回放 | 本機 + 雲端列表／播放 |
| 裁判 | 名單、抽籤、OBS 連結 |

回放 API：
- `GET /api/rooms/{code}/replays`
- `POST /api/rooms/{code}/replays`（裁判 token）
- `POST /api/rooms/{code}/replays/{id}/video`（multipart 或 raw mp4）

Storage 路徑：`replay-videos/rooms/{ROOM}/{id}.mp4`

## TestFlight

```bash
cd mobile
npm install -g eas-cli
eas login
eas build:configure   # 若未設定 projectId
eas build --platform ios --profile preview
eas submit --platform ios --profile production
```

`eas.json` 內填 `appleTeamId`、`ascAppId`。首次需 Apple Developer 帳號。

## 進度

- [x] Expo App + 計分 + 相機
- [x] 回放上傳 Supabase + 雲端列表
- [ ] TestFlight 實機驗證（需 Apple 帳號）
- [ ] App Store 上架
