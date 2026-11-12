// The time proof belongs to one HTTPS response, independently of quote/balance
// timestamps. Keep both RTT bounds: the lower one limits future data and the
// upper one expires data conservatively. A new sample never rewinds old data.
export const SERVICE_TIME_NONCE_HEADER = 'x-fstswap-time-nonce';
export const SERVICE_TIME_HEADER = 'x-fstswap-server-time';
export const SERVICE_TIME_NONCE_PATTERN = /^[0-9a-f]{32}$/;
export const serviceMonotonic = () => globalThis.performance?.now?.() ?? Date.now();
const invalid = () => new Error('INVALID_SERVICE_TIME');
const invalidBounds = () => ({lower:Infinity,upper:Infinity});

export function createServiceClock({clock=Date.now,monotonic=serviceMonotonic}={}) {
  const requests=new WeakSet(),samples=new WeakSet();
  let anchor=null;
  function elapsedBounds(sample,now) {
    const elapsed=now-sample.receivedAt;
    return Number.isFinite(elapsed)&&elapsed>=0
      ? {lower:sample.lower+elapsed,upper:sample.upper+elapsed} : invalidBounds();
  }
  function boundsAt(candidate,now) {
    if(!Number.isFinite(now))return invalidBounds();
    const prior=anchor?elapsedBounds(anchor,now):null;
    if(candidate&&!samples.has(candidate))throw invalid();
    const next=candidate?elapsedBounds(candidate,now):null;
    if(prior&&next)return {lower:Math.max(prior.lower,next.lower),upper:Math.max(prior.upper,next.upper)};
    if(prior||next)return prior||next;
    const wall=clock();return {lower:wall,upper:wall};
  }
  const bounds=candidate=>boundsAt(candidate,monotonic());
  return {
    start(maxRttMs) {
      const startedAt=monotonic();
      if(!Number.isFinite(startedAt)||!Number.isFinite(maxRttMs)||maxRttMs<=0)throw invalid();
      let nonce=null;
      if(typeof globalThis.crypto?.getRandomValues==='function') {
        nonce=[...globalThis.crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      }
      const request=Object.freeze({nonce,startedAt,maxRttMs});requests.add(request);return request;
    },
    measure(headers,request) {
      if(!requests.delete(request))throw invalid();
      const nonce=headers?.get?.(SERVICE_TIME_NONCE_HEADER),wireTime=headers?.get?.(SERVICE_TIME_HEADER);
      // Older APIs receive the original strict wall-clock checks. Incomplete or
      // mismatched proofs never silently downgrade to that compatibility path.
      if(nonce==null&&wireTime==null)return null;
      if(!request.nonce||!SERVICE_TIME_NONCE_PATTERN.test(nonce||'')||nonce!==request.nonce||
        !/^(?:0|[1-9][0-9]{0,15})$/.test(wireTime||''))throw invalid();
      const server=Number(wireTime),receivedAt=monotonic(),rtt=receivedAt-request.startedAt;
      if(!Number.isSafeInteger(server)||server<0||!Number.isFinite(rtt)||rtt<0||rtt>request.maxRttMs||server+rtt>Number.MAX_SAFE_INTEGER)throw invalid();
      const sample=Object.freeze({lower:server,upper:server+rtt,receivedAt});
      samples.add(sample);return sample;
    },
    bounds,
    publish(sample,current=()=>true) {
      if(!sample||!samples.has(sample)||!current())return false;
      const receivedAt=monotonic(),next=boundsAt(sample,receivedAt);
      if(!Number.isFinite(next.lower)||!Number.isFinite(next.upper)||!Number.isFinite(receivedAt)||!current())return false;
      anchor={...next,receivedAt};return true;
    },
    now(){return bounds().upper;},
    remainingUntil(expiresAt){return Number.isFinite(expiresAt)?Math.max(0,expiresAt-bounds().upper):0;},
  };
}
