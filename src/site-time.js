export function localTimestamp(value,lang='en',{seconds=true}={}) {
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
 const offset=-date.getTimezoneOffset(),sign=offset>=0?'+':'−',abs=Math.abs(offset);
 const zone='UTC'+sign+Math.floor(abs/60)+(abs%60?':'+String(abs%60).padStart(2,'0'):'');
 return date.toLocaleString(lang==='zh'?'zh-CN':'en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})})+' · '+zone;
}

// Daily quotas follow the London date encoded in public game IDs, rather than
// the viewer's current day. Older UUID records use their original upload time.
export function analysisQuotaDate(metadata) {
 if (/^[0-9]{10,14}$/.test(metadata.id || '')) {
  const day=metadata.id.slice(0,8);
  return day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8);
 }
 const date=new Date(metadata.uploadedAt);if(!Number.isFinite(date.getTime()))return '—';
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
}
