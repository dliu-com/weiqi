export function initialLanguage(saved, browserLanguage) {
  return ['zh','en'].includes(saved) ? saved : /^zh(?:-|$)/i.test(browserLanguage || '') ? 'zh' : 'en';
}
let saved;
try { saved = localStorage.getItem('weiqi-language'); } catch {}
export let language = initialLanguage(saved, navigator.language);
export const t = (zh,en) => language === 'zh' ? zh : en;
const messages = {
  "棋谱库":"Record library", "关于":"About", "使用指南":"How to use",
  "新棋局": "New game", "确认死子": "Confirm dead stones", "请标记所有死子，然后点击确认查看胜负。": "Mark all dead stones, then confirm to see the winner.",
  "下载 SGF": "Download SGF", "暂停计时": "Pause clock", "请先恢复计时。": "Resume the clock before playing.",
  "历史棋局 · DL": "Game history · DL", "加载更多": "Load more",
  "编辑名称": "Edit names", "历史棋局": "Game history", "棋局信息": "Game details",
  "棋局名称": "Game name", "黑方棋手": "Black player", "白方棋手": "White player", "保存": "Save",
  "名称须为 1–80 个字符。": "Game names must contain 1–80 characters.",
  "棋手姓名不能超过 40 个字符。": "Player names must be at most 40 characters.",

  "围棋 · DL": "Go · DL",
  "围棋": "Go",
  "十九路 · 双人对弈": "19 × 19 · Two players",
  "规则说明": "Rules",
  "黑白之间": "Black & white",
  "专注棋盘 ↗": "Focus board ↗",
  "此刻棋局": "CURRENT GAME",
  "正在载入…": "Loading…",
  "正在连接云端棋局": "Connecting to the shared game",
  "黑方提子": "Black captures",
  "白方提子": "White captures",
  "停一手": "Pass",
  "悔棋": "Undo",
  "认输": "Resign",
  "重新开始": "New game",
  "终局数子": "Chinese area scoring",
  "双方点击棋盘标记死子，再分别确认。标记改变后需要重新确认。": "Mark dead groups on the board, then both players confirm. Changes reset both confirmations.",
  "黑方确认": "Black confirms",
  "白方确认": "White confirms",
  "继续对弈": "Resume play",
  "自动同步": "Auto-sync",
  "每 5 秒": "Every 5 seconds",
  "正在连接…": "Connecting…",
  "立即同步": "Sync now",
  "连续 10 分钟无落子，自动暂停同步。": "Auto-sync pauses after 10 minutes without a move.",
  "落子记录": "Move tree",
  "返回当前棋局": "Return to live",
  "0 手": "0 moves",
  "黑先白后，从第一手开始。": "Black plays first. Your game starts here.",
  "对弈规则": "Rules of play",
  "知道了": "Got it",
  "取消": "Cancel",
  "确认": "Confirm",
  "19 × 19 棋盘，黑先白后。点击空交叉点落子；无气的棋块被提走。禁止自杀及全局同形（棋盘局面不可重复），停一手不受同形限制。": "19 × 19 board. Black plays first. Click an empty intersection to play. Groups without liberties are captured. Suicide and repeating an earlier board position (positional superko) are prohibited; passing is exempt.",
  "双方连续停一手后进入数子。点击整块棋子标记或取消死子，确认死子后查看胜负，再确认结果结束棋局。采用中国数子法：活子与围空合计，白贴 7.5 点（相当于 3¾ 子）。提子数仅供参考，不额外计分。": "Two consecutive passes start scoring. Click groups to mark or unmark dead stones; confirm the dead stones, review the winner, then confirm the result to finish. Chinese area scoring counts living stones plus territory. White receives 7.5 points komi (equivalent to 3¾ zi). Captures do not add points.",
  "这是休闲对弈工具。死活、双活及特殊争议请双方协商；有争议时选择“继续对弈”。仅被一方围住的空点计入该方，双方相邻的空点为公气。": "This is a casual game. Agree on dead groups, seki and special disputes together, or resume play. Empty regions surrounded by only one color count for that color; regions touching both colors are neutral.",
  "全站共用一盘棋，任何访问者都能操作。新局会替换当前棋局。": "The site shares one game. Any visitor can play either side. Starting a new game replaces the current game.",
  "DL 首页": "DL home",
  "十九路围棋棋盘，方向键移动，回车落子": "19 × 19 Go board. Use arrow keys to move and Enter to play.",
  "十九路围棋，双人对弈。云端保存，多设备同步。": "19 × 19 Go for two players, saved in the cloud and synced across devices.",
  "请选择空的交叉点。": "Choose an empty intersection.",
  "禁入点：此处落子后没有气。": "Suicide is not allowed: this group would have no liberties.",
  "禁止全局同形：请先在别处落子。": "Superko: this move repeats an earlier board position.",
  "棋局版本无效。": "Invalid game revision.",
  "棋局已更新，请重试。": "The game has changed. Please try again.",
  "操作无效。": "Invalid action.",
  "还没有可以悔棋的记录。": "There are no moves to undo.",
  "请选择要标记的棋子。": "Choose a stone to mark.",
  "请选择执棋方。": "Choose a player.",
  "请选择认输方。": "Choose the resigning player.",
  "本局已达 600 手，请双方停一手结算或另开新局。": "The 600-move limit has been reached. Pass to score or start a new game.",
  "当前棋局不能执行此操作。": "This action is not available in the current game phase.",
  "棋谱已达保存上限，请结算当前棋局或重新开始。": "The game record has reached its storage limit. Finish scoring or start a new game.",
  "页面不存在。": "Page not found.",
  "不支持此请求方法。": "Unsupported request method.",
  "请求来源无效。": "Invalid request origin.",
  "请使用 JSON 格式。": "JSON is required.",
  "请求过大。": "Request is too large.",
  "请求格式无效。": "Invalid request format.",
  "棋局已更新，已为你同步最新进度。": "The game has changed. The latest position has been loaded.",
  "棋局暂时无法同步，请稍后重试。": "The game cannot sync right now. Please try again."
};
export function translateError(message) { return language === 'zh' ? message : messages[message] || 'The request failed. Please sync and try again.'; }
const nodes = [];
const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode, original = node.textContent;
  if (messages[original.trim()]) nodes.push({node,original});
}
const attributes = [];
document.querySelectorAll('[aria-label],meta[name="description"]').forEach(node => {
  for (const attr of ['aria-label','content']) {
    const original = node.getAttribute(attr);
    if (messages[original]) attributes.push({node,attr,original});
  }
});
export function setLanguage(value) {
  language = value === 'zh' ? 'zh' : 'en';
  try { localStorage.setItem('weiqi-language',language); } catch {}
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  for (const {node,original} of nodes) node.textContent = language === 'zh' ? original : original.replace(original.trim(),messages[original.trim()]);
  for (const {node,attr,original} of attributes) node.setAttribute(attr,language === 'zh' ? original : messages[original]);
  document.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
}
setLanguage(language);
