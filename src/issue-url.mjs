export function journalKey(raw){
  try{const u=new URL(raw),route=u.pathname.match(/^\/journal\/[^/]+(?=\/|$)/)?.[0];return u.protocol==='https:'&&route?u.origin+route:null;}catch{return null;}
}
export function isIssueURL(raw,home){
  try{const u=new URL(raw);return !!journalKey(raw)&&(!home||journalKey(raw)===journalKey(home))&&/^\/journal\/[^/]+\/(?:volumes-and-issues\/\d[^/]*|vol\/\d+(?:\/[^/]+)*|issues?\/[^/]+)\/?$/.test(u.pathname);}catch{return false;}
}
