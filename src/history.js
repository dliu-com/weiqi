import { t, language, setLanguage } from './i18n.js';
const $ = id => document.getElementById(id);
let games = [], current = null, cursor = null, loading = false, failed = false;
function date(value) { return value ? new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB') : t('日期未知','Unknown date'); }
function render() {
  document.title = t('历史棋局 · DL','Game history · DL');
  $('history-message').textContent = loading ? t('正在载入…','Loading…') : failed ? t('加载失败，请重试。','Could not load games. Please retry.') : t('点击棋局查看棋谱、修改名称和棋手。','Open a game to review its tree or edit its name and players.');
  $('more').hidden = !cursor && !failed;
  $('more').disabled = loading;
  const fragment = document.createDocumentFragment();
  for (const game of [...(current ? [{...current,id:null}] : []), ...[...games].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))]) {
    const link = document.createElement('a'); link.className='game-entry'; link.href=game.id ? './?game='+encodeURIComponent(game.id) : './';
    const name=document.createElement('strong');name.textContent=game.gameName || date(game.createdAt || game.updatedAt);
    const info=document.createElement('small');info.textContent=(game.id ? t('已归档','Archived') : t('当前棋局','Current game'))+' · '+date(game.createdAt || game.updatedAt);
    link.append(name,info);fragment.append(link);
  }
  $('games').replaceChildren(fragment);
}
async function load() {
  if(loading)return;loading=true;failed=false;render();
  try {
    if(!current){const r=await fetch('/api/game',{cache:'no-store'});if(!r.ok)throw Error();current=(await r.json()).state;}
    const r=await fetch('/api/games'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{cache:'no-store'});
    if(!r.ok)throw Error();const data=await r.json();
    const known=new Map(games.map(g=>[g.id,g]));for(const g of data.games)known.set(g.id,g);games=[...known.values()];cursor=data.cursor;
  }catch{failed=true;}finally{loading=false;render();}
}
$('more').onclick=load;
document.querySelectorAll('[data-language]').forEach(button=>button.onclick=()=>{setLanguage(button.dataset.language);render();});
load();
