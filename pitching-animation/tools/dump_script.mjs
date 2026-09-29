// 把 content/script.js 轉成 JSON，給 Python 的 TTS 工具讀
import { SCRIPT } from '../content/script.js';
process.stdout.write(JSON.stringify(SCRIPT, null, 1));
