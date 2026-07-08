// プラットフォーム差し替え点: localStorage / JSONダウンロード / ファイル読込。
// 将来 Electron/Tauri 化する際は、この関数群のシグネチャを保ったまま実装を差し替える。

/** localStorage に値をJSON文字列として保存する */
export function saveJSON(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

/** localStorage から値を読み込む。存在しない/パース失敗時は null */
export function loadJSON<T>(key: string): T | null {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function removeJSON(key: string): void {
  window.localStorage.removeItem(key);
}

/** データをJSONファイルとしてブラウザにダウンロードさせる */
export function downloadJSON(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** input[type=file] 等で選択された File を読み込みJSONとしてパースする */
export function readJSONFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('JSONの解析に失敗しました'));
      }
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsText(file);
  });
}
