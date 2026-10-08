async function resolveAnalysisModel(fetchHtml=async()=>{const response=await fetch('https://katagotraining.org/networks/',{headers:{'User-Agent':'KataGo-analysis-library/1.0 (+https://weiqi.dliu.com/about.html)'},signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Unable to check the official KataGo networks');return response.text();}){
 const html=await fetchHtml();
 // Prefer the strongest network with a confident rating; newly uploaded networks are still being rated.
 for(const label of ['Strongest confidently-rated network','Latest network']){
  const match=html.match(new RegExp(label+':<\\/span>\\s*<a\\s+href="(https:\\/\\/media\\.katagotraining\\.org\\/uploaded\\/networks\\/models\\/kata1\\/([A-Za-z0-9_-]+\\.bin\\.gz))"'));
  if(match)return {name:match[2],key:'models/'+match[2],url:match[1],checkedAt:new Date().toISOString()};
 }
 throw Error('The official KataGo network could not be identified');
}
module.exports={resolveAnalysisModel};
