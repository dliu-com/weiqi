// The same viewer-request handler is tested locally and deployed by CloudFormation.
// Link-preview crawlers get a static page with the final board image instead of the app.
var previewBots=/facebookexternalhit|Facebot|meta-externalagent|WhatsApp|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|SkypeUriPreview|Pinterest|redditbot|Applebot|Embedly|Iframely|vkShare|Viber|Snapchat|kakaotalk-scrap|Mastodon|Bluesky|Line\//i;
function handler(event){
 var request=event.request,uri=request.uri,aliases={'/analysis':'/photo.html','/play':'/play.html','/record':'/editor.html','/game':'/library.html','/guide':'/how-to-use.html','/docs':'/about.html','/docs/cost':'/cost.html','/docs/security':'/security.html','/docs/photo-recognition':'/photo-recognition.html','/docs/benchmarks':'/benchmarks.html'};
 var old={'/history.html':'/game','/rules.html':'/guide','/library.html':'/game','/how-to-use.html':'/guide','/about.html':'/docs','/about':'/docs','/benchmarks.html':'/docs/benchmarks','/benchmarks':'/docs/benchmarks','/cost.html':'/docs/cost','/cost':'/docs/cost','/security.html':'/docs/security','/security':'/docs/security','/photo-recognition.html':'/docs/photo-recognition','/photo-recognition':'/docs/photo-recognition','/site-health.html':'/docs#health','/docs/health':'/docs#health'},
  page=uri.length>1?uri.replace(/\/$/,''):uri;
 if(old[page]){var target=old[page],hash='',at=target.indexOf('#');if(at>=0){hash=target.slice(at);target=target.slice(0,at);}var query=[];for(var key in request.querystring){var item=request.querystring[key],values=item.multiValue||[item];for(var i=0;i<values.length;i++)query.push(key+'='+values[i].value);}return {statusCode:301,statusDescription:'Moved Permanently',headers:{location:{value:target+(query.length?'?'+query.join('&'):'')+hash}}};}
 if(/^\/game\/(?:[0-9]{10,14}|[a-f0-9-]{36})\/report\/?$/.test(uri))request.uri='/report.html';
 else if(/^\/game\/(?:[0-9]{10,14}|[a-f0-9-]{36})\/?$/.test(uri)){var agent=request.headers&&request.headers['user-agent'];request.uri=agent&&previewBots.test(agent.value)?'/share/'+uri.split('/')[2]+'.html':'/record.html';}
 else if(aliases[page])request.uri=aliases[page];
 return request;
}
