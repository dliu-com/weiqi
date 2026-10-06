// The preview and PDF share the same document plan: cover, contents, sections.
export function reportPagination(titles){
 if(!Array.isArray(titles)||titles.some(title=>typeof title!=='string'||!title.trim()))throw Error('Report section titles are required.');
 return {pageCount:titles.length+2,contents:titles.map((title,index)=>({title,page:index+3,target:'report-page-'+(index+3)}))};
}
