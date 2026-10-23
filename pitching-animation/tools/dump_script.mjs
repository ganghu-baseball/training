// 把 content/script.js 轉成 JSON，給 Python 的 TTS 工具讀
// 以目前工作目錄的 content/ 為準（投球、打擊兩個專案共用這支工具）
import path from 'path'; import { pathToFileURL } from 'url';
const { SCRIPT } = await import(pathToFileURL(path.resolve('content/script.js')).href);
process.stdout.write(JSON.stringify(SCRIPT, null, 1));
