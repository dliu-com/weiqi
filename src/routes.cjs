// The same viewer-request handler is tested locally and deployed by CloudFormation.
function handler(event){
 var request=event.request,uri=request.uri,aliases={'/analysis':'/photo.html','/play':'/play.html','/record':'/editor.html','/game':'/library.html','/guide':'/how-to-use.html','/about':'/about.html','/cost':'/cost.html','/security':'/security.html','/photo-recognition':'/photo-recognition.html','/benchmarks':'/benchmarks.html'};
 var old={'/history.html':'/game','/rules.html':'/guide','/library.html':'/game','/how-to-use.html':'/guide','/about.html':'/about','/benchmarks.html':'/benchmarks'};
 if(old[uri]){var query=[];for(var key in request.querystring){var item=request.querystring[key],values=item.multiValue||[item];for(var i=0;i<values.length;i++)query.push(key+'='+values[i].value);}return {statusCode:301,statusDescription:'Moved Permanently',headers:{location:{value:old[uri]+(query.length?'?'+query.join('&'):'')}}};}
 if(/^\/(?:record|game)\/(?:[0-9]{10,14}|[a-f0-9-]{36})\/report\/?$/.test(uri))request.uri='/report.html';
 else if(/^\/(?:record|game)\/(?:[0-9]{10,14}|[a-f0-9-]{36})\/?$/.test(uri))request.uri='/record.html';
 else {uri=uri.replace(/\/$/,'');if(aliases[uri])request.uri=aliases[uri];}
 return request;
}
