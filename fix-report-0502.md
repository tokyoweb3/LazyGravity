# 2026-05-02 鏡像同步殘影問題修復報告

## 1. 問題概述
在 Telegram 與 Antigravity IDE 的鏡像同步過程中，發現了持續性的「殘影（Echo）」現象。表現為：當用戶發送新訊息時，Telegram 會先同步顯示上一輪的助理回覆，隨後才開始更新新內容。

## 2. 核心原因分析 (Root Cause)

### A. 雙引擎計數衝突 (Dual-Engine Consensus Failure)
系統同時使用兩套 DOM 萃取引擎：
- **Legacy Engine**: 基於傳統選擇器，容易鎖定到隱藏的靜態節點（例如固定長度 878 字元的系統模板）。
- **Structured Engine**: 基於語法分析，能精準抓取最新對話。

**Bug 邏輯**: 
基準點捕捉時，舊引擎鎖定了 878 字元的錯誤節點。監控時，新引擎抓到了真實的舊訊息。防禦網比對兩者「長度不符」，誤以為是新產生的內容，從而發放了通關證，導致殘影流出。

### B. 被動監聽模式無防禦 (Passive Monitor Defenseless)
當用戶在本機（PC）端直接輸入時，系統觸發的是被動監控模式。該模式原本沒有執行基準點捕捉（Baseline Capture），導致它在啟動瞬間會把畫面上已存在的內容全部視為新訊息。

### C. Telegram HTML 解析報錯 (Telegram 400 Error)
在處理長訊息（Chunked Send）時，未對文字進行 HTML 轉義。當回覆包含 `<...>` 格式的標籤時，Telegram 會因「Unsupported start tag」報錯並拒絕顯示訊息，造成訊息在畫面上消失。

## 3. 修復方案與實作細節

### 3.1 引擎大一統與遺留代碼清理
- **全面移除 Legacy 萃取邏輯**：不再使用 `RESPONSE_TEXT` 選擇器進行基準比對。
- **統一基準點 (Baseline Consistency)**：基準點捕捉現在強制使用與監控過程完全相同的 `Structured Extraction`。這確保了「基準點文字」與「監控初期的文字」在字符級別上完全一致，比對準確率提升至 100%。

### 3.2 強化被動監聽機制
- **先行快照 (Pre-emptive Snapshot)**：在 `telegramJoinCommand.ts` 中，偵測到用戶本機輸入的瞬間，立即調用 `captureResponseMonitorBaseline` 拍下指紋。
- **注入防禦屬性**：將捕捉到的指紋注入被動監控器，使其具備完整的殘影識別能力。

### 3.3 內容過濾邏輯極簡化
- 移除了所有不穩定的「節點索引 (Index)」與「計數器 (Count)」比對。
- **核心過濾規則**：
  `const isBaseline = normalize(currentText) === normalize(this.baselineText);`
  `const effectiveText = (isBaseline && this.lastText === null) ? null : currentText;`
  *(意即：若內容與基準點相同，且本輪監控尚未發送過任何新文字，則視為殘影予以封殺。)*

### 3.4 安全發送機制
- **HTML 轉義補丁**：在 `sendTextChunked` 與所有回覆回調中強制加入 `escapeHtml()`，解決了特殊字元導致 Telegram 訊息丟失的問題。

## 4. 測試驗證結果
- **本機連發測試**：通過。無殘影，同步即時。
- **手機連發測試**：通過。連續 4 次輸入，回覆銜接正常。
- **長訊息/標籤測試**：通過。包含特殊標籤的長文本能穩定顯示不再消失。

---
**分支狀態**: `fix/antigravity-ui-compat` (已推送到 myfork)
**修復日期**: 2026-05-02
