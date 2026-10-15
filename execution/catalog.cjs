const fs=require('node:fs');
const path=require('node:path');

function loadCatalog(root=path.resolve(__dirname,'..')) {
  const meta=JSON.parse(fs.readFileSync(path.join(root,'content/meta.json'),'utf8'));
  const directory=path.join(root,'content/features');
  const features=fs.readdirSync(directory).filter(f=>f.endsWith('.json')).sort().map(file=>{
    const data=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
    delete data.$schema;
    return data;
  }).sort((a,b)=>(a.priority??100)-(b.priority??100)||a.major.localeCompare(b.major,'ko')||a.title.localeCompare(b.title,'ko'));
  return {...meta,features};
}
module.exports={loadCatalog};
