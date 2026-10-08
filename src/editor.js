import './site-shell.js';
import {mountTimeControl} from './time-control.js';
import {t,translateError} from './i18n.js';
import {BoardView} from './board-view.js';
import {recordingTree,recordingSgf,populateRecordingDetails,addRecordingMove,promoteRecordingBranch,setRecordingHandicap,setRecordingRules,recordingResultFields,recordingResultValue,newRecordingSgf,RecordingNavigation,recordingNodeIndex} from './recording-tree.js';
import {MAX_SGF_BYTES} from './sgf.js';
import {libraryRequest} from './library-api.js';
import {renderMoveLabel} from './move-label.js';
import {RecordingTreeView} from './recording-tree-view.js';
import {RecordingSequenceEdit} from './recording-sequence-edit.js';
import {mountStoneSound,prepareStoneSound,playStoneSound} from './stone-sound.js';
const $=id=>document.getElementById(id);let record=null,selected=0,draft=null,dirty=false,writing=false,conflict=false,publishing=false,saveId=null,saveTimer,confirmation,inserting=false,repositioning=false,sequenceEdit=null,applyingSequence=false,sequenceRotation=0;
const timeControl=mountTimeControl($('editor-details'),t);
const treeView=new RecordingTreeView($('editor-tree'),select);let navigation=new RecordingNavigation();
const board=new BoardView($('board'),{onPoint:place,horizontalArrows:false});
mountStoneSound($('editor-sound'));
try{const saved=Number(localStorage.getItem('weiqi.record.rotation')||0);if(Number.isInteger(saved))board.setRotation(saved);}catch{}
function resetBoardRotation(){board.setRotation(0);try{localStorage.removeItem('weiqi.record.rotation');}catch{}}
function warn(message){$('editor-notice').textContent=message;}
function confirm(title,message,run){confirmation=run;$('editor-confirm-title').textContent=title;$('editor-confirm-text').textContent=message;$('editor-confirm').showModal();}
$('editor-cancel').onclick=()=>$('editor-confirm').close();$('editor-accept').onclick=()=>{$('editor-confirm').close();confirmation?.();};
function changed(){navigation.remember(record,selected);promoteRecordingBranch(record,selected);if(sequenceEdit){sequenceEdit.selected=selected;sequenceEdit.refresh();render();return;}dirty=true;saveId=null;try{localStorage.setItem('weiqi.record.unsaved',JSON.stringify({sgf:recordingSgf(record),selected:recordingNodeIndex(record,selected),expectedRevision:draft.revision}));}catch{}render();clearTimeout(saveTimer);saveTimer=setTimeout(flush,300);}
async function flush(){
 if(sequenceEdit||writing||!dirty||conflict||publishing)return false;writing=true;const source=recordingSgf(record),position=selected;render(false);
 try{const response=await libraryRequest('/api/draft',{action:'update',expectedRevision:draft.revision,sgf:source,selected:recordingNodeIndex(record,position)});draft=response.draft;if(recordingSgf(record)===source&&selected===position){dirty=false;try{localStorage.removeItem('weiqi.record.unsaved');}catch{}}else{try{localStorage.setItem('weiqi.record.unsaved',JSON.stringify({sgf:recordingSgf(record),selected:recordingNodeIndex(record,selected),expectedRevision:draft.revision}));}catch{}}warn('');}
 catch(e){conflict=e.statusCode===409;warn(conflict?t('其他设备已修改公共草稿。请重新载入草稿后继续修改。','Another device changed the public draft. Reload the draft before making further changes.'):t('尚未保存到云端。当前修改已在此浏览器暂存；请重试。','Not saved to the cloud. Changes are backed up in this browser; please retry.'));}
 finally{writing=false;render(false);if(dirty&&!conflict){clearTimeout(saveTimer);saveTimer=setTimeout(flush,1500);}}return !dirty&&!conflict;
}
function adopt(value){if(value.publication?.status==='ready'&&(draft?.publication?.status!=='ready'||draft.publication.id!==value.publication.id))resetBoardRotation();draft=value;record=recordingTree(value.sgf);inserting=false;repositioning=false;const defaultsAdded=populateRecordingDetails(record);selected=Math.min(value.selected||0,record.nodes.length-1);navigation=new RecordingNavigation();navigation.remember(record,selected);dirty=defaultsAdded;conflict=false;fillDetails();render();if(defaultsAdded){clearTimeout(saveTimer);saveTimer=setTimeout(flush,300);}}
async function load(){try{const response=await libraryRequest('/api/draft');adopt(response.draft);const backup=JSON.parse(localStorage.getItem('weiqi.record.unsaved')||'null');if(backup){record=recordingTree(backup.sgf);populateRecordingDetails(record);selected=Math.min(backup.selected||0,record.nodes.length-1);navigation.remember(record,selected);dirty=true;conflict=backup.expectedRevision!==draft.revision;fillDetails();warn(t('已恢复此浏览器中未上传的修改。','Recovered changes not yet uploaded from this browser.'));render();if(!conflict)void flush();}}catch{warn(t('无法载入公共草稿。请刷新重试。','Unable to load the public draft. Refresh to retry.'));}}
function select(id){if(applyingSequence||!record||!record.nodes[id])return;inserting=Boolean(sequenceEdit);repositioning=false;warn('');selected=id;changed();}
function step(count){if(record)select(navigation.step(record,selected,count));}
function applyCorrection(next){record=next.record;selected=next.selected;navigation=new RecordingNavigation();inserting=Boolean(sequenceEdit);repositioning=false;warn('');changed();}
function place(index){if(!record||conflict||publishing||applyingSequence||draft.publication?.status==='pending')return;prepareStoneSound();try{if(repositioning)applyCorrection(sequenceEdit.reposition(selected,index));else if(sequenceEdit||inserting)applyCorrection(sequenceEdit.insert(selected,index));else{selected=addRecordingMove(record,selected,index);warn('');changed();}if(record.nodes[selected].board[index]===record.nodes[selected].move.side)playStoneSound();}catch(e){warn(inserting||repositioning?t('此修改会导致后续棋步不合法。请先修改或删除相关后续变化。',e.message):translateError(e.message));}}
function fillDetails(){const f=$('editor-details');for(const [key,value]of Object.entries({name:record.name,black:record.players.black,white:record.players.white,blackRank:record.playerRanks?.black||'',whiteRank:record.playerRanks?.white||'',date:record.date,venue:record.venue||'',komi:record.komi,handicap:Number(record.rootProperties.HA?.[0]||0)}))f.elements[key].value=value;f.elements.rules.value=['Japanese','Chinese','Korean','AGA'].find(rule=>new RegExp('^'+rule+'(?:$|\\s)','i').test(record.rules))||(/日本/.test(record.rules)?'Japanese':/中国|中國/.test(record.rules)?'Chinese':/韩国|韓國/.test(record.rules)?'Korean':'');const result=recordingResultFields(record.result);const winner=/^[BW]/.test(result.choice)?result.choice[0]:result.choice;f.elements.result.value=winner;f.elements.resultReason.value=result.choice.endsWith('points')?'points':/^[BW][RT]$/.test(result.choice)?result.choice[1]:'';f.elements.resultMargin.value=result.margin;timeControl.fill(record.timeControl);resultFields();}
function resultFields(){
 const f=$('editor-details'),win=/^[BW]$/.test(f.elements.result.value),points=win&&f.elements.resultReason.value==='points';
 $('result-reason-field').hidden=!win;f.elements.resultReason.required=false;f.elements.resultReason.disabled=!win||Boolean(sequenceEdit)||publishing||conflict;
 $('result-margin-field').hidden=!points;f.elements.resultMargin.required=points;f.elements.resultMargin.disabled=!points||Boolean(sequenceEdit)||publishing||conflict;
 for(const name of ['name','black','white']){const input=f.elements[name];input.setCustomValidity(input.value.trim()?'':t('请填写此项。','Please complete this field.'));}
}
function render(refreshTree=true){
 document.title=t('记录棋局','Record game')+' · DL Weiqi';
 const labels={'editor-title':['记录棋局','Record game'],'editor-pass':[(record&&(repositioning?record.nodes[selected].move.side:record.nodes[selected].turn)==='W'?'白方':'黑方')+'停一手',(record&&(repositioning?record.nodes[selected].move.side:record.nodes[selected].turn)==='W'?'White':'Black')+' passes'],'editor-delete':['删除单手','Delete move'],'editor-reposition':[repositioning?'取消调整':'调整落点',repositioning?'Cancel reposition':'Reposition move'],'editor-insert':[sequenceEdit?'插入棋步':inserting?'取消插入':'插入单手',sequenceEdit?'Insert moves':inserting?'Cancel insert':'Insert move'],'editor-clear':['清空棋盘','Clear board'],'editor-rotate':['↻ 旋转棋盘 · '+board.rotation*90+'°','↻ Rotate board · '+board.rotation*90+'°'],'editor-upload-label':['打开本地 SGF 文件','Open local SGF file'],'editor-save':[publishing?'正在保存…':'保存棋局',publishing?'Saving…':'Save game'],'editor-save-help':['保存后开始 AI 分析。','AI analysis starts after saving.'],'draft-reload':['重新载入公共草稿','Reload public draft'],'details-summary':['棋局信息','Game details'],'label-title':['棋局名称','Game title'],'label-black':['黑方棋手','Black player'],'label-white':['白方棋手','White player'],'label-black-rank':['黑方段级位','Black rank'],'label-white-rank':['白方段级位','White rank'],'label-date':['日期','Date'],'label-rules':['规则','Rules'],'label-komi':['贴目','Komi'],'label-handicap':['让子','Handicap'],'label-result':['棋局结果','Game result'],'label-result-reason':['获胜原因 / 目数','Reason / points'],'label-result-margin':['胜出目数','Winning margin (points)'],'label-venue':['地点','Location'],'editor-tree-title':['棋谱树','Game tree'],'editor-cancel':['取消','Cancel'],'editor-accept':['确认','Confirm']};for(const [id,[zh,en]]of Object.entries(labels))$(id).textContent=t(zh,en);
 const f=$('editor-details');for(const input of f.elements)input.disabled=Boolean(sequenceEdit)||publishing||conflict;f.elements.handicap.disabled=!record||record.nodes.length>1||publishing||conflict||Boolean(sequenceEdit);[...f.elements.rules.options].forEach(o=>o.textContent=({Japanese:t('日本规则','Japanese'),Chinese:t('中国规则','Chinese'),Korean:t('韩国规则','Korean'),AGA:'AGA'})[o.value]);[...f.elements.result.options].forEach(o=>o.textContent=({'0':t('未完成','Unfinished'),B:t('黑方获胜','Black wins'),W:t('白方获胜','White wins')})[o.value]);[...f.elements.resultReason.options].forEach(o=>o.textContent=({points:t('按目数','By points'),R:t('认输','Resignation'),T:t('超时','Timeout'),'':''})[o.value]);
 resultFields();
 $('draft-status').textContent=sequenceEdit?t('本地修改 · 尚未应用','Local edits · not applied'):conflict?t('草稿冲突 · 等待重新载入','Draft conflict · reload required'):publishing?t('正在保存棋局…','Saving game…'):writing||dirty?t('正在保存…','Saving…'):'';$('draft-status').hidden=!$('draft-status').textContent;
 $('draft-reload').hidden=!conflict||Boolean(sequenceEdit);$('editor-save').classList.toggle('is-loading',publishing);$('editor-save').disabled=!record||conflict||publishing||Boolean(sequenceEdit);$('editor-file').disabled=!record||publishing||conflict||Boolean(sequenceEdit);$('editor-upload-label').disabled=!record||publishing||conflict||Boolean(sequenceEdit);$('editor-delete').disabled=!selected||publishing||conflict||applyingSequence;$('editor-reposition').disabled=!selected||publishing||conflict||applyingSequence;$('editor-reposition').setAttribute('aria-pressed',String(repositioning));$('editor-insert').disabled=!record||publishing||conflict||applyingSequence;$('editor-insert').setAttribute('aria-pressed',String(inserting));$('editor-clear').disabled=!record||publishing||conflict||Boolean(sequenceEdit);$('editor-pass').disabled=!record||publishing||conflict||applyingSequence;
 renderSequenceEdit();
 timeControl.disable(Boolean(sequenceEdit)||publishing||conflict||applyingSequence);
 if(!record)return;const node=record.nodes[selected];board.render(node.board,{last:node.move?.index,turn:repositioning?node.move.side:node.turn,interactive:!publishing&&!conflict&&!applyingSequence});renderMoveLabel($('editor-move'),{depth:node.depth,move:node.move,t});
 if(!refreshTree)return;
 $('editor-tree').setAttribute('aria-label',t('棋谱树','Game tree'));
 $('editor-tree-help').textContent=t('当前选中的变化自动成为主分支，其他变化在下方展开。点击棋子切换局面。','The selected sequence becomes the main branch automatically. Other variations branch below. Click a stone to switch positions.');
 treeView.render(record,selected,t,navigation.continuations);
}
function renderSequenceEdit(){
 const active=Boolean(sequenceEdit);
 $('editor-edit-sequence').textContent=t('编辑棋谱','Edit sequence');$('editor-edit-sequence').hidden=active;
 $('editor-edit-sequence').disabled=!record||dirty||writing||publishing||conflict||draft?.publication?.status==='pending';
 $('sequence-edit-panel').hidden=!active;
 $('sequence-edit-title').textContent=t('编辑棋谱','Edit sequence');
 $('sequence-edit-help').textContent=t('后续着法会保留。修改仅存在于此页面；刷新或取消会丢弃。应用修改后，云端检查完整棋谱，合法后才保存。','Later moves are kept. Edits stay on this page; refresh or Cancel discards them. Apply edits checks the complete sequence in the cloud before saving.');
 $('sequence-edit-apply').textContent=applyingSequence?t('云端正在检查…','Checking in cloud…'):t('应用修改','Apply edits');
 $('sequence-edit-cancel').textContent=t('取消修改','Cancel edits');
 $('sequence-edit-apply').disabled=!active||applyingSequence||conflict;$('sequence-edit-cancel').disabled=applyingSequence;
 const node=record?.nodes[selected];
 $('sequence-edit-preview').textContent=node?.previewIssue||node?.previewIncomplete?t('预览仅显示最近可重现的局面。请修正相关棋步；最终以云端检查为准。','Preview shows the last reproducible position. Repair the affected moves; the cloud checks the final sequence.') : '';
}
function beginSequenceEdit(){
 if(sequenceEdit)return !applyingSequence;
 if(!record||publishing||conflict||draft?.publication?.status==='pending')return false;
 if(dirty||writing){warn(t('请等待当前修改保存后再编辑棋步。','Wait for the current changes to save before editing the sequence.'));return false;}
 clearTimeout(saveTimer);sequenceRotation=board.rotation;sequenceEdit=new RecordingSequenceEdit(record,selected);record=sequenceEdit.record;inserting=true;repositioning=false;warn('');render();return true;
}
$('editor-edit-sequence').onclick=beginSequenceEdit;
$('sequence-edit-cancel').onclick=()=>{
 if(!sequenceEdit||applyingSequence)return;const original=sequenceEdit.cancel();sequenceEdit=null;board.setRotation(sequenceRotation);record=original.record;selected=original.selected;inserting=false;repositioning=false;navigation=new RecordingNavigation();navigation.remember(record,selected);fillDetails();warn('');render();
};
$('sequence-edit-apply').onclick=async()=>{
 if(!sequenceEdit||applyingSequence||conflict)return;
 const pending=sequenceEdit;applyingSequence=true;warn('');render(false);
 try{
  // No local acceptance check and no localStorage backup: the API validates
  // every variation before its conditional, atomic draft write.
  const response=await libraryRequest('/api/draft',{action:'update',expectedRevision:draft.revision,...pending.submission(selected)});
  sequenceEdit=null;adopt(response.draft);saveId=null;
  warn('');
 }catch(e){
  conflict=e.statusCode===409;
  warn(conflict?t('云端草稿已改变。请取消修改，然后重新载入以查看最新保存的棋谱。','The cloud draft changed. Cancel edits, then reload to check the latest saved sequence.'):
   e.statusCode===400?t('云端检查未通过，草稿未改变：','Cloud check failed. The draft is unchanged: ')+e.message:
   t('未能确认保存。修改仍在本页面，请重试；取消或刷新会丢弃。','Saving could not be confirmed. Edits remain on this page. Retry; Cancel or refresh discards them.'));
 }finally{applyingSequence=false;render();}
};
$('editor-first').onclick=()=>select(0);$('editor-prev').onclick=()=>step(-1);$('editor-next').onclick=()=>step(1);$('editor-back-ten').onclick=()=>step(-10);$('editor-forward-ten').onclick=()=>step(10);$('editor-last').onclick=()=>{let n=selected;while(navigation.next(record,n)!==undefined)n=navigation.next(record,n);select(n);};
$('editor-pass').onclick=()=>{if(!record||conflict||publishing||applyingSequence)return;try{if(repositioning)applyCorrection(sequenceEdit.reposition(selected,null));else if(sequenceEdit||inserting)applyCorrection(sequenceEdit.insert(selected,null));else{selected=addRecordingMove(record,selected,null);changed();}}catch(e){warn(t('此修改会导致后续棋步不合法。请先修改或删除相关后续变化。',e.message));}};
$('editor-delete').onclick=()=>{if(!selected||!beginSequenceEdit())return;try{applyCorrection(sequenceEdit.delete(selected));}catch(e){warn(translateError(e.message));}};
$('editor-insert').onclick=()=>{if(!beginSequenceEdit())return;repositioning=false;inserting=sequenceEdit?true:!inserting;warn(inserting||repositioning?t('点击棋盘，在当前局面后插入一手。后续棋步会保留。','Click the board to insert one move after this position. Later moves will be kept.'):'');render(false);};
$('editor-reposition').onclick=()=>{if(!selected||!beginSequenceEdit())return;inserting=false;repositioning=!repositioning;warn(repositioning?t('点击棋盘，修改所选棋步的落点。后续棋步会保留。','Click the board to reposition the selected move. Later moves will be kept.'):'');render(false);};
$('editor-rotate').onclick=()=>{board.setRotation(board.rotation+1);if(!sequenceEdit){try{localStorage.setItem('weiqi.record.rotation',String(board.rotation));}catch{}}render(false);};
$('editor-clear').onclick=()=>confirm(t('清空棋盘？','Clear the board?'),t('当前棋步、分支和让子将清空，棋局信息会保留。','All moves, branches and handicap stones will be cleared. Game details will be kept.'),()=>{const fresh=recordingTree(newRecordingSgf());for(const key of ['name','players','playerRanks','date','rules','komi','result','venue','timeControl'])fresh[key]=structuredClone(record[key]);record=fresh;resetBoardRotation();selected=0;inserting=false;repositioning=false;navigation=new RecordingNavigation();fillDetails();warn('');changed();});

$('editor-details').onchange=event=>{if(sequenceEdit||applyingSequence)return;const f=$('editor-details');resultFields();if(!f.checkValidity())return;if(event.target.name==='rules'){record=setRecordingRules(record,f.elements.rules.value);f.elements.komi.value=record.komi;}if(!f.elements.handicap.disabled&&Number(f.elements.handicap.value)!==Number(record.rootProperties.HA?.[0]||0)){record=setRecordingHandicap(record,Number(f.elements.handicap.value));f.elements.komi.value=record.komi;}record.name=f.elements.name.value.trim()||'Recorded game';record.players={black:f.elements.black.value.trim(),white:f.elements.white.value.trim()};record.playerRanks={black:f.elements.blackRank.value.trim(),white:f.elements.whiteRank.value.trim()};record.date=f.elements.date.value;record.venue=f.elements.venue.value.trim();record.timeControl=timeControl.value();record.komi=Number(f.elements.komi.value);record.rules=f.elements.rules.value;try{record.result=recordingResultValue(/^[BW]$/.test(f.elements.result.value)?f.elements.result.value+(f.elements.resultReason.value==='points'?'points':!f.elements.resultReason.value?'+':f.elements.resultReason.value):f.elements.result.value,f.elements.resultMargin.value);}catch(e){warn(e.message);return;}changed();};
$('editor-details').oninput=$('editor-details').onchange;
$('editor-upload-label').onclick=()=>$('editor-file').click();
$('editor-file').onchange=async()=>{if(sequenceEdit||applyingSequence)return;const file=$('editor-file').files[0];if(!file)return;try{if(file.size>MAX_SGF_BYTES)throw Error(t('文件不能超过 256 KB。','Files must be no larger than 256 KB.'));const source=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()),imported=recordingTree(source);confirm(t('用 SGF 替换当前草稿？','Replace the draft with this SGF?'),t('当前棋盘与所有分支将被清空，并以此文件替换。所有设备都会更新。','The current board and all draft branches will be replaced by this file on every device.'),()=>{record=imported;inserting=false;repositioning=false;populateRecordingDetails(record);selected=0;navigation=new RecordingNavigation();fillDetails();changed();});}catch(e){warn(e.message);}$('editor-file').value='';};
async function publish(){if(sequenceEdit||applyingSequence)return;while(writing)await new Promise(resolve=>setTimeout(resolve,100));if(dirty&&!(await flush()))return;publishing=true;saveId=draft.publication?.status==='pending'?draft.publication.id:saveId||crypto.randomUUID();render(false);try{const response=await libraryRequest('/api/draft',{action:'save',expectedRevision:draft.revision,id:saveId});if(response.draft)adopt(response.draft);try{localStorage.removeItem('weiqi.record.unsaved');}catch{}location.assign('/game/'+response.id);}catch(e){warn(e.statusCode===409?t('公共草稿已更新，请重新载入后保存。','The public draft changed. Reload before saving.'):e.statusCode===400?t('无法保存棋局：','Cannot save this game: ')+e.message:t('保存未完成。请重试“保存棋局”；重试不会创建重复棋谱。','Save did not finish. Retry Save game; retries reuse the same game.'));}finally{publishing=false;render(false);}}
$('editor-save').onclick=()=>{resultFields();if(!record||!$('editor-details').reportValidity())return;confirm(t('保存当前分支？','Save the current branch?'),t('仅保存当前选中的完整分支，其他变化将删除。保存后开始 AI 分析。','Only the complete currently selected branch will be saved. Other variations will be deleted. AI analysis starts after saving.'),publish);};
$('draft-reload').onclick=()=>confirm(t('重新载入公共草稿？','Reload the public draft?'),t('此浏览器尚未同步的修改将被替换。','Unsynced changes in this browser will be replaced.'),async()=>{try{localStorage.removeItem('weiqi.record.unsaved');}catch{}await load();});
document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,dialog')||!record)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);}});
window.addEventListener('site-language-change',()=>render());
setInterval(async()=>{if(sequenceEdit||document.hidden||dirty||writing||publishing||conflict||!draft||$('editor-confirm').open||document.activeElement?.closest('form'))return;try{const response=await libraryRequest('/api/draft');if(!sequenceEdit&&!dirty&&!writing&&!publishing&&!conflict&&(response.draft.revision>draft.revision||JSON.stringify(response.draft.publication)!==JSON.stringify(draft.publication)))adopt(response.draft);}catch{}},5000);
render();void load();
