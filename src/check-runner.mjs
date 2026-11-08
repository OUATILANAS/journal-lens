export function checkRunner({jobs,check,call,save=()=>{},timer=setTimeout,now=Date.now}){
  const timers=new Map();
  async function run(id){
    const job=jobs.get(id);if(!job||job.status==='cancelled'||job.status==='running')return;
    const generation=(job.generation||0)+1;job.generation=generation;job.status='running';job.nextRetry=null;job.pass=(job.pass||0)+1;save();
    try{
      const result=await check(job.input,{call,previousReport:job.result,onCheckpoint:report=>{if(job.generation===generation){job.result=structuredClone(report);save();}},onProgress:item=>{if(job.generation===generation){job.progress.push(item);job.progress=job.progress.slice(-150);save();}}});
      if(job.generation!==generation)return;
      job.result=result;
      job.status=result.needsSelection?'needs_selection':result.eligibility==='excluded'?'rejected':result.complete?'complete':'waiting';
      job.error=null;
    }catch(e){if(job.generation!==generation)return;job.error=e.message;job.status='waiting';job.progress.push({name:'Source access',status:'retrying',detail:e.message});}
    if(job.status==='waiting'){
      const delay=Math.min(600000,60000*2**Math.min(job.pass-1,4));job.nextRetry=now()+delay;
      const handle=timer(()=>{timers.delete(id);run(id);},delay);handle?.unref?.();timers.set(id,handle);
    }
    save();
  }
  function cancel(id){const job=jobs.get(id);if(!job)return false;clearTimeout(timers.get(id));timers.delete(id);job.generation=(job.generation||0)+1;job.status='cancelled';job.nextRetry=null;save();return true;}
  function resume(id){const job=jobs.get(id);if(!job||job.status==='running')return false;clearTimeout(timers.get(id));timers.delete(id);job.status='queued';run(id);return true;}
  return {run,cancel,resume};
}
