const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function embed(root,dist,catalog,dictionary) {
  function asset(relative){const file=path.resolve(dist,relative);if(!file.startsWith(dist+path.sep)||!fs.statSync(file).isFile())throw Error('HTML 공유본 에셋 경로를 확인해주세요.');const types={'.woff2':'font/woff2','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png'};return 'data:'+(types[path.extname(file)]||'application/octet-stream')+';base64,'+fs.readFileSync(file).toString('base64');}
  const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeJSON=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const normalize=text=>text.replace(/\r\n?/g,'\n');
  const safeScript=text=>normalize(text).replace(/<\/script/gi,'<\\/script');
  const hash=text=>"'sha256-"+crypto.createHash('sha256').update(text).digest('base64')+"'";
  let html=normalize(fs.readFileSync(path.join(dist,'index.html'),'utf8'));
  const clone=JSON.parse(JSON.stringify(catalog));
  for(const f of clone.features)f.screen.src=asset(f.screen.src);
  const scripts=[safeJSON(clone),safeJSON(dictionary),...['search.js','app.js'].map(file=>safeScript(fs.readFileSync(path.join(dist,file),'utf8')))];
  const css=normalize(fs.readFileSync(path.join(dist,'styles.css'),'utf8')).replace(/url\(\s*(['"]?)(?:\.\/|\/)?(assets\/[^)'"\s]+)\1\s*\)/g,(_,q,relative)=>"url('"+asset(relative)+"')");
  html=html.replace(/<link\b(?=[^>]*rel=["']stylesheet["'])[^>]*>/gi,'');
  html=html.replace(/<script\b[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi,'');
  html=html.replace(/(["'])(?:\.\/|\/)?assets\/(logo\.svg|favicon\.svg)\1/g,(_,q,name)=>q+asset('assets/'+name)+q);
  html=html.replace(/<\/head>/i,()=>'<style>'+css+'</style></head>');
  let publicURL=process.env.GUIDE_PUBLIC_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL||'';
  if(publicURL&&!/^https:\/\//.test(publicURL))publicURL='https://'+publicURL;
  if(publicURL){const url=new URL(publicURL);if(url.protocol!=='https:'||url.username||url.password)throw Error('GUIDE_PUBLIC_URL은 안전한 HTTPS 주소를 사용해주세요.');publicURL=url.origin+'/';}
  const blocks='<script id="guide-data" type="application/json" data-public-url="'+esc(publicURL)+'">'+scripts[0]+'</script><script id="guide-dictionary" type="application/json">'+scripts[1]+'</script><script>'+scripts[2]+'</script><script>'+scripts[3]+'</script>';
  html=html.replace(/<\/body>/i,()=>blocks+'</body>');
  const csp="default-src 'none'; script-src "+scripts.map(hash).join(' ')+"; style-src "+hash(css)+"; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'";
  html=html.replace(/<head>/i,()=>'<head><meta http-equiv="Content-Security-Policy" content="'+esc(csp)+'">');
  fs.writeFileSync(path.join(dist,'skylife-counselor-guide.html'),html);
  return {bytes:Buffer.byteLength(html),publicURL:publicURL||null};
}
module.exports={embed};
