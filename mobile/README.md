# BEYBATTLE（Expo App）

App Store 統一客戶端：開房、計分、相機錄製、**雲端回放**。

## 開發

```bash
# Terminal 1 — API
cd cloud-player && npm run dev

# Terminal 2 — App
cd mobile
cp .env.example .env
# 真機：EXPO_PUBLIC_API_BASE=http://<Mac-LAN-IP>:3000
npm install
npx expo start
```

Supabase 需執行 `schema-rooms.sql` + `schema-room-replays.sql`。

## 回放上傳

1. 裁判在「鏡頭」錄製 → 自動 POST meta + 上傳 mp4
2. 「回放」分頁可睇本機／雲端；待上傳可「上傳全部」
3. 其他裝置入同一房號可睇雲端回放

## TestFlight

```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile preview
```

首次在 [expo.dev](https://expo.dev) 建立專案後，把 `app.json` → `extra.eas.projectId` 換成真實 ID。

詳見 [`../cloud-player/APP-STORE.md`](../cloud-player/APP-STORE.md)。
