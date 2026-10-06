export function gameResult(result){
 const raw=String(result||'').trim(),match=raw.match(/^([BW])\+(.*)$/i);
 if(!raw)return null;
 if(!match)return {winner:null,zh:/^(0|draw|jigo)$/i.test(raw)?'和棋':raw,en:/^(0|draw|jigo)$/i.test(raw)?'Draw':raw};
 const winner=match[1].toUpperCase(),sideZh=winner==='B'?'黑方':'白方',sideEn=winner==='B'?'Black':'White',reason=match[2];
 if(!reason)return {winner,zh:sideZh+'获胜',en:sideEn+' won'};
 if(/^(r|res|resign|resignation)$/i.test(reason))return {winner,zh:sideZh+'获胜（对方认输）',en:sideEn+' won by resignation'};
 if(/^(t|time|timeout)$/i.test(reason))return {winner,zh:sideZh+'获胜（对方超时）',en:sideEn+' won on time'};
 if(/^(f|forfeit)$/i.test(reason))return {winner,zh:sideZh+'获胜（对方弃权）',en:sideEn+' won by forfeit'};
 if(/^\d+(?:\.\d+)?$/.test(reason))return {winner,zh:sideZh+'赢 '+reason+' 目',en:sideEn+' won by '+reason+' points'};
 return {winner,zh:sideZh+'获胜 · '+raw,en:sideEn+' won · '+raw};
}
