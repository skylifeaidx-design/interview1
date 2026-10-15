const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../dist');
const headerRules=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../vercel.json'),'utf8')).headers;
const headers=headerRules[0].headers;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer((request,response)=>{
  for(const {key,value} of headers)response.setHeader(key,value);
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);return response.end();}
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch{response.writeHead(400);return response.end();}
  for(const rule of headerRules.slice(1))if(rule.source===pathname)for(const {key,value} of rule.headers)response.setHeader(key,value);
  if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(p=>p.startsWith('.'))){response.writeHead(403);return response.end();}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){response.writeHead(403);return response.end();}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);return response.end('페이지를 찾을 수 없습니다.');}
  response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
  if(request.method==='HEAD')return response.end();
  fs.createReadStream(file).pipe(response);
});
server.listen(Number(process.env.PORT)||4180,'127.0.0.1',()=>console.log('미리보기: http://127.0.0.1:'+(Number(process.env.PORT)||4180)));
