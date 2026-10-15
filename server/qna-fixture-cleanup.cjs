// Temporary, exact fingerprint retirement of this release's generated QA fixture.
// Remove this module after the deployment verification. Never accepts client selectors.
const {createHash}=require('node:crypto');
const fixtureId='q-6b96135c-651d-454c-b7ca-a405eb82838a';
const fingerprint='39f802fa6018913c73fb589b63348ba72a5d514dfde383ce49a0d3d15c9e1a1c';
module.exports=function retireGeneratedFixture(snapshot,toPublic,at){
 const record=snapshot.questions.find(q=>q.id===fixtureId);
 if(!record||createHash('sha256').update(JSON.stringify(toPublic(record))).digest('hex')!==fingerprint)return false;
 snapshot.questions=snapshot.questions.filter(q=>q.id!==fixtureId);
 snapshot.audit.unshift({action:'retire-generated-qa-fixture',at,questionId:fixtureId,record});
 snapshot.audit=snapshot.audit.slice(0,100);
 return true;
};
