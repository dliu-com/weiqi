export function localTimestamp(value,lang='en') {
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
 const offset=-date.getTimezoneOffset(),sign=offset>=0?'+':'−',abs=Math.abs(offset);
 const zone='UTC'+sign+Math.floor(abs/60)+(abs%60?':'+String(abs%60).padStart(2,'0'):'');
 return date.toLocaleString(lang==='zh'?'zh-CN':'en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · '+zone;
}
