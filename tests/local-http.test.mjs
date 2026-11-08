import assert from 'node:assert/strict';
import {publisherHTTP} from '../scripts/publisher-http.mjs';
for(const url of ['http://link.springer.com/','https://127.0.0.1/','https://evil.test/','https://idp.springer.com/login','https://user:pass@idp.springer.com/authorize'])await assert.rejects(()=>publisherHTTP(url));
const controller=new AbortController();controller.abort();
await assert.rejects(()=>publisherHTTP('https://link.springer.com/journal/12650',{signal:controller.signal}),/timed out/);
console.log('Local publisher transport URL restrictions and cancellation checks passed.');
