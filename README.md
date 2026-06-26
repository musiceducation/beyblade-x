# 咩咩遊樂園 — Beyblade X 陀螺競賽

場內計分、賽程、鏡頭倒數、回放與雲端選手查閱。

## 啟動主機

資料夾名稱含空格（`beyblade x`），**路徑必須加引號**：

```bash
cd "/Users/kenneth/Desktop/beyblade x"
./start.sh
```

或：

```bash
"/Users/kenneth/Desktop/beyblade x/start.sh"
```

瀏覽器開啟：**https://localhost:8443**（手機鏡頭需 HTTPS）

首次使用請複製設定檔：

```bash
cp arena-config.example.js arena-config.local.js
cp arena-secrets.example.json arena-secrets.local.json
```

雲端同步與 Vercel 選手頁設定見 [supabase/README.md](supabase/README.md)。

## 賽前建議

1. 按 **✅ 開賽檢查** 跑完所有項目  
2. 用 **?** 查看快捷鍵  
3. **選手 · 賽程 → 匯出／備份** 定期備份 JSON  
