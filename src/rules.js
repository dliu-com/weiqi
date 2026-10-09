import {t,setLanguage} from './i18n.js';
const sections = [
  [
    [
      "1 · 围棋规则",
      "1 · Go rules"
    ],
    [
      [
        [
          "落子与提子",
          "Playing and capturing"
        ],
        [
          "19 × 19 棋盘，黑先白后，轮流在空交叉点落子。上下左右相连的同色棋子组成棋块；与棋块相邻的空点是“气”。没有气的棋块会被提走。",
          "Play on a 19 × 19 board. Black starts, then players alternate on empty intersections. Stones of the same color connected horizontally or vertically form a group. Adjacent empty intersections are its liberties. A group with no liberties is captured."
        ]
      ],
      [
        [
          "禁入点与打劫",
          "Suicide and repetition"
        ],
        [
          "禁止自杀：提走对方棋子后，己方新棋块仍须有气。本应用禁止全局同形，即落子不能重复本局当前分支中已出现的棋盘局面；停一手不受此限制。",
          "Suicide is prohibited: after any captures, your new group must have a liberty. This app uses positional superko: a move cannot repeat a board position from the current branch of the game. Passing is exempt."
        ]
      ],
      [
        [
          "停一手与终局",
          "Passing and ending the game"
        ],
        [
          "无须落子时可“停一手”。双方连续停一手后进入数子阶段。也可点击“认输”，在结果窗口选择哪方中盘胜。",
          "Choose Pass when you do not want to place a stone. Two consecutive passes begin scoring. Alternatively, select Resign and choose the winner by resignation in the result window."
        ]
      ],
      [
        [
          "中国数子法",
          "Chinese area scoring"
        ],
        [
          "得分为盘上活子数加上仅由己方围住的空点数。白方另加 7.5 点贴目（相当于 3¾ 子）。提子数仅供参考，不额外计分。双方棋子共同接触的空区不计入任何一方。",
          "Your score is living stones on the board plus empty intersections enclosed only by your color. White receives 7.5 points komi (equivalent to 3¾ zi). Captures are shown for reference and do not add points. Empty regions touching both colors count for neither side."
        ]
      ],
      [
        [
          "死子与争议",
          "Dead stones and disagreements"
        ],
        [
          "数子时，点击棋块标记或取消整块死子。标记所有死子后点击“确认死子”，查看胜方和胜差，再确认结果结束棋局。本应用不自动判断死活或双活；请双方协商，有争议可“继续对弈”。",
          "During scoring, click a group to mark or unmark it as dead. After marking all dead groups, select Confirm dead stones, review the winner and margin, then confirm the result to finish. The app does not automatically judge life, death or seki. Agree together, or choose Resume play to resolve a disagreement."
        ]
      ]
    ]
  ],
  [
    [
      "2 · 页面使用说明",
      "2 · Using this app"
    ],
    [
      [
        [
          "共享棋局与新棋局",
          "Shared game and new games"
        ],
        [
          "全站共用一盘当前棋局，无账号或执子方限制；任何访问者都可操作黑白双方。顶部“新棋局”会创建新的一局，并把上一局保存到“历史棋局”。请先与对方确认。",
          "The site shares one current game, without accounts or assigned sides. Any visitor can operate either color. New game at the top creates a fresh game and saves the previous one in Game history. Agree with your opponent before starting another game."
        ]
      ],
      [
        [
          "落子与网络状态",
          "Moves and connection status"
        ],
        [
          "点击空交叉点落子；鼠标预览颜色跟随当前执子方。每次操作前会核对云端棋局，若棋局已改变，会先同步并请你重新操作。提交中显示“正在提交…”，失败显示“未发送”。恢复网络后先核对棋盘再重试。",
          "Click an empty intersection; the hover stone matches the side to play. Before an action, the app checks the latest saved position. If it changed, the board updates and you must try again. A move shows Submitting… while pending and Not sent on failure. After reconnecting, check the board before retrying."
        ]
      ],
      [
        [
          "自动同步",
          "Auto-sync"
        ],
        [
          "默认开启，页面可见时每 3 秒检查更新。连续 10 分钟无落子后自动关闭，可重新打开开关，或点击“立即同步”。切回页面或恢复网络时也会尝试同步。请求超过 10 秒无响应或连接失败，会显示醒目的页内提示；成功同步后提示消失。",
          "Auto-sync is on by default and checks for updates every 3 seconds while the page is visible. It switches off after 10 minutes without a move. Turn it back on or select Sync now. Returning to the page or reconnecting also triggers a sync attempt. Failed requests or requests with no response for 10 seconds show an inline warning, which clears after a successful sync."
        ]
      ],
      [
        [
          "计时与暂停",
          "Clocks and pausing"
        ],
        [
          "首手落子后开始计时，只计当前执子方。默认“正计时”：记录累计用时，没有时间限制。若第一手前选择“读秒”，先用基本时间，用完后进入读秒：每次读秒内落子则重新计时，超过一次读秒则扣减一次；最后一次读秒用完即超时。超时不判负，双方计时停止，对局继续。“暂停计时”会暂停计时及落子，点击“恢复计时”后继续。进入数子或棋局结束时停止计时。悔棋不会退回已用时间；读秒时剩余时间恢复到该手之前。",
          "Timing starts after the first move and runs for the side to play. The default, Count-up, records elapsed time with no limit. If Byo-yomi is chosen before the first move, main time is used first, then byo-yomi periods: moving within a period keeps it, and using a full period uses it up. When the last period runs out, that player is out of time. This does not lose the game; both clocks stop and play continues. Pause clock stops timing and prevents moves until Resume clock is selected. Scoring and game end stop the clock. Undo does not refund elapsed time; with byo-yomi, the time left returns to what it was before the undone move."
        ]
      ],
      [
        [
          "关闭页面后的计时",
          "Timing while pages are closed"
        ],
        [
          "自动同步也会报告页面在线状态。所有设备连续 1 分钟未报告在线后，计时自动暂停，最后一次在线报告之后的时间不计入。返回页面后自动恢复；手动暂停则须手动恢复。关闭自动同步、隐藏页面或查看本说明页，都不会报告对弈页面在线；其他设备仍在线时计时继续。",
          "Auto-sync also reports that a game page is active. After one minute without a report from any device, the clock auto-pauses and excludes time after the last report. Returning resumes it automatically; a manual pause requires manual resume. Turning off auto-sync, hiding the game page or viewing this guide stops that page’s reports. Timing continues if another device remains active."
        ]
      ],
      [
        [
          "悔棋与棋谱树",
          "Undo and the move tree"
        ],
        [
          "悔棋撤回最近一手，并同步到所有设备；按钮标明撤回的是哪一方。撤回的棋步从棋谱中删除，不会保留为分支或导出到 SGF。点击棋谱树可查看任意历史局面，复盘时可试下，试下棋步仅临时显示，不保存到棋谱或云端；可撤回或清除试下。选择其他节点或返回当前棋局时自动清除。点击“返回当前棋局”继续对弈。复盘期间仍会同步当前棋局。",
          "Undo retracts the latest move on all devices; its label identifies that move’s color. Undone moves are removed from the move tree and SGF export. Select a node to review an earlier position. You can try temporary moves while reviewing; these are never saved to the move tree or cloud. Undo or clear the preview using its controls. Selecting another node or returning to live discards the preview. Select Return to live to continue the game. The live game keeps syncing during review."
        ]
      ],
      [
        [
          "棋局信息、历史与导出",
          "Names, history and export"
        ],
        [
          "“编辑名称”可修改棋局名称及黑白棋手姓名；默认棋局名称为“现场对弈休闲棋局”。“历史棋局”可打开已归档棋局。棋谱记录落子时间与累计用时；旧棋步可能没有时间记录。“下载 SGF”导出棋谱分支、姓名、结果及时间备注。",
          "Edit names changes the game name and both player names. The default game name is “Live casual game”. Game history opens archived games. Moves record timestamps and elapsed totals; older moves may lack timing records. Download SGF exports branches, names, the result and timing comments."
        ]
      ],
      [
        [
          "显示与语言",
          "Display and language"
        ],
        [
          "“专注棋盘”把棋盘放大到浏览器页面内，不进入系统全屏。可点击退出或按 Esc 返回。页面顶部可切换中文 / English；首次使用跟随浏览器语言，并记住你的选择。键盘方向键可移动棋盘焦点，回车落子。",
          "Focus board enlarges the board within the browser page, without entering system fullscreen. Exit focus or press Escape to return. Choose 中文 / English at the top. The initial language follows your browser, and your choice is remembered. Arrow keys move the board focus; Enter plays a stone."
        ]
      ]
    ]
  ]
];
function render() {
 document.title=t('对弈规则与使用说明 · DL','Rules and guide · DL');
 document.getElementById('guide-title').textContent=t('对弈规则与使用说明','Rules and guide');
 const nav=document.getElementById('guide-nav'), content=document.getElementById('guide-content');nav.replaceChildren();content.replaceChildren();
 sections.forEach(([title,items],index)=>{
  const section=document.createElement('section');section.id='section-'+index;
  const heading=document.createElement('h2');heading.textContent=t(...title);section.append(heading);
  const link=document.createElement('a');link.href='#'+section.id;link.textContent=t(...title);nav.append(link);
  items.forEach(([title,body])=>{const article=document.createElement('article');const h=document.createElement('h3');h.textContent=t(...title);const p=document.createElement('p');p.textContent=t(...body);article.append(h,p);section.append(article);});content.append(section);
 });
}
document.querySelectorAll('[data-language]').forEach(button=>button.onclick=()=>{setLanguage(button.dataset.language);render();});
render();
