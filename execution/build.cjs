const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {loadCatalog}=require('./catalog.cjs');
const {validateProject}=require('./validate.cjs');
const root=path.resolve(__dirname,'..');
const dist=path.join(root,'dist');
const result=validateProject(root);
// This directory is exclusively generated output; never follow a link outside it.
if(path.dirname(dist)!==root||path.basename(dist)!=='dist'||fs.lstatSync(dist,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('빌드 출력 경로를 확인해주세요.');
fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(dist,{recursive:true});

// Copy only the four reviewed client files and the explicit public asset tree.
for(const file of ['index.html','styles.css','app.js','search.js'])fs.copyFileSync(path.join(root,'src',file),path.join(dist,file));
const catalog=loadCatalog(root);
const publicRoot=path.join(root,'public');
const realRoot=fs.realpathSync(root),realPublic=fs.realpathSync(publicRoot);
if(realPublic!==path.join(realRoot,'public'))throw Error('공개 에셋 폴더는 프로젝트 안의 실제 폴더여야 합니다.');
const assetNames=['assets/logo.svg','assets/favicon.svg','assets/Pretendard-Regular.woff2','assets/Pretendard-Medium.woff2','assets/Pretendard-SemiBold.woff2','assets/Pretendard-Bold.woff2'];
const files=new Set([...assetNames,...catalog.features.map(f=>f.screen.src)]);
for(const relative of files){const from=path.resolve(publicRoot,relative),to=path.resolve(dist,relative);const actual=fs.realpathSync(from);if(!from.startsWith(publicRoot+path.sep)||!to.startsWith(dist+path.sep)||actual!==path.join(realPublic,relative)||!fs.statSync(actual).isFile())throw Error('허용된 실제 정적 에셋만 배포할 수 있습니다.');fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(actual,to);}
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'content/search-dictionary.json'),'utf8'));
const catalogJson=JSON.stringify(catalog);
fs.writeFileSync(path.join(dist,'data.json'),catalogJson);
fs.writeFileSync(path.join(dist,'search-dictionary.json'),JSON.stringify(dictionary));
const hash=crypto.createHash('sha256').update(catalogJson).update(JSON.stringify(dictionary));
for(const file of ['index.html','styles.css','app.js','search.js'])hash.update(fs.readFileSync(path.join(dist,file)));
fs.writeFileSync(path.join(dist,'release.json'),JSON.stringify({version:catalog.version,contentUpdated:catalog.updated,guideUpdated:catalog.guideUpdated,features:result.features,buildHash:hash.digest('hex'),commit:process.env.VERCEL_GIT_COMMIT_SHA||null}));
const single=require('./single-html.cjs').embed(root,dist,catalog,dictionary);
console.log(JSON.stringify({빌드:'완료',...result,output:'dist',singleHtml:single}));
