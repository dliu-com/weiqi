async function resolveLatestModel(fetchHtml=async()=>{const response=await fetch('https://katagotraining.org/networks/',{headers:{'User-Agent':'KataGo-analysis-library/1.0 (+https://weiqi.dliu.com/about.html)'},signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Unable to check the latest KataGo network');return response.text();}){
 const html=await fetchHtml();
 const match=html.match(/Latest network:<\/span>\s*<a\s+href="(https:\/\/media\.katagotraining\.org\/uploaded\/networks\/models\/kata1\/([A-Za-z0-9_-]+\.bin\.gz))"/);
 if(!match)throw Error('The latest official KataGo network could not be identified');
 return {name:match[2],key:'models/'+match[2],url:match[1],checkedAt:new Date().toISOString()};
}
module.exports={resolveLatestModel};
