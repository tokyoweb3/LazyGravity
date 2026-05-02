const normalize = (t) => (t || '').replace(/[\s\r\n]+/g, ' ').trim();

let baselineText = "收到本機端測試！\n\n請觀察 Telegram 上的同步情況...";
let lastText = null;

let polls = [
  "收到本機端測試！\n\n請觀察 Telegram 上的同步情況...", // poll 1 (echo)
  "收到本機端測試！\n\n請觀察 Telegram 上的同步情況...", // poll 2 (echo)
  "這是一個全新的回覆", // poll 3 (new)
  "這是一個全新的回覆，正在輸入中" // poll 4 (new)
];

for (let currentText of polls) {
    const isBaseline = currentText !== null && baselineText !== null && normalize(currentText) === normalize(baselineText);
    
    // Simplest possible suppression
    const effectiveText = (isBaseline && lastText === null) ? null : currentText;
    
    console.log(`currentText: "${currentText.slice(0, 10)}..." -> effectiveText: ${effectiveText ? `"${effectiveText.slice(0, 10)}..."` : 'null'}`);
    
    if (effectiveText !== null) {
        lastText = effectiveText;
    }
}
