import './site-shell.js';
import {localTimestamp} from './site-time.js';
import {t,setLanguage} from './i18n.js';
import {flow,tiers,stats,icon} from './flow-diagram.js';
const text=value=>Array.isArray(value)?t(value[0],value[1]):value;
// Cards linking to the other info pages, each with one headline fact from that page.
function readMore(){
 const section=document.createElement('section'),heading=document.createElement('h2'),grid=document.createElement('div');
 section.className='about-read-more';heading.textContent=t('延伸阅读','Read more');grid.className='about-cards';
 for(const [href,name,title,line,key]of [
  ['/benchmarks','chart',['CPU / GPU 基准实验','CPU / GPU benchmarks'],['支持 GPU 与访问数选择的测试','Tests behind the GPU and visit choices'],['深度 3,000 次：T4 约 44 分钟','Deep 3,000 visits ≈ 44 min on T4']],
  ['/cost','budget',['网站运行成本','Site running costs'],['网站承担，用户免费','Paid by the site, free for users'],['深度 AI US$0.50–0.75 / 局 · 3 小时对局 US$0.52','Deep AI US$0.50–0.75 / game · 3 h live game US$0.52']],
  ['/security','shield',['安全审查','Security review'],['线上渗透测试与威胁模型','Live penetration test and threat model'],['2026 年 10 月 8 日测试','Tested 8 Oct 2026']],
  ['/photo-recognition','camera',['照片识别原理','How photo recognition works'],['从棋盘照片到可编辑局面','From a board photo to an editable position'],['6 张实拍照片中 5 张完全正确','5 of 6 real photos exact']]
 ]){
  const card=document.createElement('a'),body=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('span'),fact=document.createElement('span');
  card.className='about-card';card.href=href;body.className='about-card-text';small.className='about-card-line';fact.className='about-card-key';
  strong.textContent=text(title);small.textContent=text(line);fact.textContent=text(key);
  body.append(strong,small,fact);card.append(icon(name,'large'),body);grid.append(card);
 }
 section.append(heading,grid);return section;
}
function render(){
 document.title=t('关于 · DL','About · DL');document.getElementById('about-title').textContent=t('技术架构','Technical architecture');
 const fragment=document.createDocumentFragment();
 fragment.append(stats([[t('0 台','0'),t('空闲时运行的服务器','servers running when idle'),'power'],[t('≈ 5 分钟','≈ 5 min'),t('快速 AI 复盘','quick AI review'),'clock'],[t('≈ 1 小时','≈ 1 h'),t('深度 AI 复盘','deep AI review'),'gpu'],[t('≈ 3 秒','≈ 3 s'),t('分析一个局面','AI for one position'),'katago']]),systemMap(),deepFlow(),positionFlow(),gpuFallback(),readMore(),quickAnalysisLicence());
 document.getElementById('about-content').replaceChildren(fragment);
}
window.addEventListener('site-language-change',render);render();

function quickAnalysisLicence(){
 const p=document.createElement('p'),link=(href,text)=>{const a=document.createElement('a');a.href=href;a.textContent=text;return a;};
 p.className='licence-line';
 p.append(t('AI 分析 © 2026 DL。','AI analysis © 2026 DL. '),link('/photo-assets/LICENSE.txt','AGPL-3.0'),t('；无担保。','; no warranty. '),link('/photo-assets/photo-source.tar.gz',t('下载源码','Download source')),' · ',link('/photo-assets/NOTICES.txt',t('第三方许可','Third-party notices')),' · ',link('https://huggingface.co/kaya-go/moku-v4',t('识别模型及源码','Recognition model and source')));
 return p;
}

function systemMap(){
 return tiers({title:t('系统总览','System map'),rows:[
  {badge:t('用户','Users'),label:t('浏览器','Browser'),nodes:[{icon:'browser',title:t('手机或电脑','Phone or computer'),text:t('无须登录','No sign-in')}]},
  {link:'HTTPS',badge:t('边缘','Edge'),label:'CloudFront',tone:'edge',nodes:[{icon:'cloudfront',title:'Amazon CloudFront',text:t('CDN · HTTPS · 安全头','CDN · HTTPS · security headers')}]},
  {link:t('页面 / API','Pages / API'),badge:t('应用','App'),label:t('按次运行','Runs per request'),tone:'app',nodes:[{icon:'s3',title:t('网站文件','Website files'),text:'S3 · HTML / JS / CSS'},{icon:'lambda',title:t('棋局 API','Game API'),text:t('对弈 · 记录 · 棋谱库','Play · record · library')},{icon:'camera',title:t('照片识别','Photo detection'),text:'Lambda · Moku v4'},{icon:'katago',title:t('快速 AI 分析','Quick AI analysis'),text:'Lambda · KataGo CPU'}]},
  {link:t('读写','Read / write'),badge:t('数据','Data'),label:t('私有存储','Private storage'),tone:'private',nodes:[{icon:'dynamodb',title:'DynamoDB',text:t('现场棋局 · 草稿 · 限额','Live game · draft · limits')},{icon:'s3',title:t('棋谱库','Record library'),text:t('S3 · SGF · AI 结果 · 报告','S3 · SGF · AI results · reports')}]},
  {link:t('记录后','After Record'),badge:t('后台','Background'),label:t('只在有任务时运行','Runs only when needed'),nodes:[{icon:'sqs',title:'Amazon SQS',text:t('分析队列','Analysis queue')},{icon:'gpu',title:'AWS Batch GPU',text:'KataGo · T4 / A10G'},{icon:'report',title:t('报告 Lambda','Report Lambda'),text:'Chromium → HTML / PDF'}]}
 ],note:t('全部资源由 AWS CDK / CloudFormation 部署在爱尔兰（eu-west-1）；CloudFront 是全球服务。存储在独立的受保护栈中，有 S3 版本和 DynamoDB 时间点恢复。','Everything is deployed with AWS CDK / CloudFormation in Ireland (eu-west-1); CloudFront is global. Storage sits in a separate protected stack with S3 versions and DynamoDB point-in-time recovery.')});
}
function deepFlow(){
 return flow({title:t('记录棋局 → 深度 AI 报告','Record game → deep AI report'),numbered:true,steps:[
  {icon:'record',title:t('记录棋局','Record game'),text:t('浏览器','Browser')},
  {icon:'library',title:t('存入棋谱库','Save'),text:'Lambda → S3'},
  {icon:'sqs',title:t('排队','Queue'),text:'SQS'},
  {icon:'gpu',title:t('GPU 分析','GPU analysis'),text:t('快速 ≈ 5 分钟 · 深度 ≈ 1 小时','Quick ≈ 5 min · deep ≈ 1 h')},
  {icon:'report',title:t('AI 报告','AI report'),text:'HTML + PDF'},
  {icon:'power',title:t('GPU 关闭','GPU stops'),text:t('空闲时不运行','Nothing runs when idle')}
 ],note:t('快速 32 次访问；深度 3,000 次访问（所有 GPU 相同）。失败后 5 分钟、15 分钟自动重试。','Quick: 32 visits. Deep: 3,000 visits on every GPU. Failures retry after 5 and 15 minutes.')});
}
function positionFlow(){
 return flow({title:t('AI 分析一个局面','AI analysis of one position'),numbered:true,steps:[
  {icon:'phone',title:t('照片 / SGF / 摆子','Photo / SGF / set up'),text:t('照片在浏览器中缩小','Photo resized in browser')},
  {icon:'camera',title:t('照片识别','Photo detection'),text:'Moku v4 · ≈ 8 s'},
  {icon:'flag',title:t('检查棋子','Check stones'),text:t('琥珀色框需检查','Amber boxes need a check')},
  {icon:'katago',title:t('快速 AI 分析','Quick AI analysis'),text:'KataGo CPU · ≈ 3 s'},
  {icon:'chart',title:t('推荐着法','Suggested moves'),text:t('胜率与目差','Win rate and score')}
 ],note:t('不保存照片和局面。全站每天 2,000 次，每个连接 500 次。','Photos and positions are not stored. 2,000 requests a day site-wide, 500 per connection.')});
}
function gpuFallback(){
 return flow({title:t('GPU 容量不足时','When GPU capacity is short'),steps:[
  {icon:'gpu',title:'A10G On-Demand',text:t('深度分析首选','First choice for deep')},
  {icon:'gpu',title:'T4 On-Demand',text:t('等待 3 分钟后','After 3 min waiting')},
  {icon:'retry',title:t('稍后重试','Retry later'),text:t('15 分钟仍无容量','Still no capacity after 15 min'),tone:'warn'}
 ]});
}
