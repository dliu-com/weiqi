// A small TeX subset rendered as MathML for the report's method appendix.
// Formulas are fixed strings in the report code, but text is still escaped.
const SYMBOLS={le:'≤',ge:'≥',cdot:'·',times:'×',in:'∈',notin:'∉',forall:'∀',sum:'∑',mid:'∣',to:'→',ne:'≠',ldots:'…',approx:'≈',infty:'∞'};
const FUNCTIONS=new Set(['max','min','argmax']);
const SPACES={quad:'1em',',':'0.17em',' ':'0.25em',';':'0.28em'};
const escape=text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function tokens(source){
 const list=[],pattern=/\\([A-Za-z]+|.)|(\d+(?:\.\d+)?)|([A-Za-z])|(\s+)|(.)/gsy;
 let match;
 while((match=pattern.exec(source))){
  if(match[1]!==undefined)list.push({type:'command',value:match[1]});
  else if(match[2]!==undefined)list.push({type:'number',value:match[2]});
  else if(match[3]!==undefined)list.push({type:'letter',value:match[3]});
  else if(match[4]!==undefined)list.push({type:'space',value:' '});
  else list.push({type:'char',value:match[5]});
 }
 return list;
}

export function texToMathML(source,{display=false}={}){
 const list=tokens(source);let index=0;
 const skip=()=>{while(list[index]?.type==='space')index++;};
 const peek=()=>{skip();return list[index];},next=()=>{skip();return list[index++];};
 const fail=message=>{throw Error('Formula '+JSON.stringify(source)+': '+message);};
 const expect=value=>{const token=next();if(token?.type!=='char'||token.value!==value)fail('expected '+value);};
 const rawGroup=()=>{
  expect('{');let depth=1,text='';
  while(index<list.length){const token=list[index++];if(token.type==='char'&&token.value==='{')depth++;if(token.type==='char'&&token.value==='}'&&!--depth)return text;text+=token.type==='command'?(SPACES[token.value]?' ':'\\'+token.value):token.value;}
  fail('unclosed text');
 };
 const group=()=>{expect('{');const items=sequence('}');expect('}');return items.length===1?items[0]:{xml:'<mrow>'+items.map(i=>i.xml).join('')+'</mrow>'};};
 const operator=(value,extra='')=>({xml:'<mo'+extra+'>'+escape(value)+'</mo>'});
 function atom(){
  const token=next();
  if(!token)fail('unexpected end');
  if(token.type==='number')return {xml:'<mn>'+token.value+'</mn>'};
  if(token.type==='letter')return {xml:'<mi>'+token.value+'</mi>'};
  if(token.type==='char'){
   if(token.value==='{'){index--;return group();}
   if(token.value==='|')return operator('|',' stretchy="false" lspace="0" rspace="0"');
   if('()[]'.includes(token.value))return operator(token.value,' stretchy="false"');
   if(token.value==='-')return operator('−');
   if(token.value==="'")return operator('′');
   if('}_^'.includes(token.value))fail('unexpected '+token.value);
   return operator(token.value);
  }
  const name=token.value;
  if(name==='frac'){const top=group(),bottom=group();return {xml:'<mfrac>'+top.xml+bottom.xml+'</mfrac>'};}
  if(name==='text')return {xml:'<mtext>'+escape(rawGroup())+'</mtext>'};
  if(name==='bar'){const base=peek()?.type==='char'&&peek().value==='{'?group():atom();return {xml:'<mrow class="report-math-bar">'+base.xml+'</mrow>'};}
  if(name in SPACES)return {xml:'<mspace width="'+SPACES[name]+'"/>'};
  if(name==='{'||name==='}')return operator(name,' stretchy="false"');
  if(name==='sum')return {...operator('∑',' movablelimits="false"'),limits:true};
  if(FUNCTIONS.has(name))return {xml:'<mi mathvariant="normal">'+name+'</mi>',limits:true};
  if(name in SYMBOLS)return operator(SYMBOLS[name]);
  fail('unknown command \\'+name);
 }
 function scripted(){
  const base=atom();let sub=null,sup=null;
  for(;;){
   const token=peek();
   if(token?.type==='char'&&token.value==="'"){next();if(sup)fail('double superscript');sup={xml:'<mo>′</mo>'};continue;}
   if(token?.type!=='char'||(token.value!=='_'&&token.value!=='^'))break;
   next();const value=peek()?.type==='char'&&peek().value==='{'?group():atom();
   if(token.value==='_'){if(sub)fail('double subscript');sub=value;}else{if(sup)fail('double superscript');sup=value;}
  }
  if(!sub&&!sup)return base;
  const [under,over,both]=base.limits?['munder','mover','munderover']:['msub','msup','msubsup'];
  if(sub&&sup)return {xml:'<'+both+'>'+base.xml+sub.xml+sup.xml+'</'+both+'>'};
  return sub?{xml:'<'+under+'>'+base.xml+sub.xml+'</'+under+'>'}:{xml:'<'+over+'>'+base.xml+sup.xml+'</'+over+'>'};
 }
 function sequence(end){
  const items=[];
  while(peek()&&!(end&&peek().type==='char'&&peek().value===end))items.push(scripted());
  return items;
 }
 const items=sequence(null);skip();
 if(index<list.length)fail('unbalanced braces');
 return '<math'+(display?' display="block"':'')+'>'+(items.length===1?items[0].xml:'<mrow>'+items.map(i=>i.xml).join('')+'</mrow>')+'</math>';
}
