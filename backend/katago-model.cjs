// The analysis network is pinned. To upgrade, change the name and SHA-256 here and redeploy;
// the GPU worker refuses a download whose SHA-256 differs.
const PINNED_ANALYSIS_MODEL={name:'kata1-tf3-b11c768-s11003M-d5973M-7gres.bin.gz',sha256:'93bdb63a3bfae4a70db0cb5265287495ecfc10b1ba1cc6814feeba1cdf055871'};
function resolveAnalysisModel(){
 const {name,sha256}=PINNED_ANALYSIS_MODEL;
 return {name,key:'models/'+name,url:'https://media.katagotraining.org/uploaded/networks/models/kata1/'+name,sha256};
}
module.exports={resolveAnalysisModel};
