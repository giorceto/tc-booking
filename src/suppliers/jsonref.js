// Json.NET (Sedna/Summer Tour) праща повтарящите се обекти като {"$ref":"5"} към обекта с "$id":"5".
// resolveRefs заменя препратките с истинските обекти и маха "$id".
function resolveRefs(data) {
  const ids = new Map();
  const collect = (x) => {
    if (!x || typeof x !== 'object') return;
    if (!Array.isArray(x) && x.$id !== undefined) ids.set(String(x.$id), x);
    for (const v of Object.values(x)) collect(v);
  };
  collect(data);
  const seen = new Map();
  const rep = (x, depth = 0) => {
    if (!x || typeof x !== 'object' || depth > 60) return x;
    if (Array.isArray(x)) return x.map((v) => rep(v, depth + 1));
    const keys = Object.keys(x);
    if (keys.length === 1 && x.$ref !== undefined) {
      const t = ids.get(String(x.$ref));
      return t ? rep(t, depth + 1) : null;
    }
    if (seen.has(x)) return seen.get(x);
    const out = {};
    seen.set(x, out);
    for (const k of keys) if (k !== '$id') out[k] = rep(x[k], depth + 1);
    return out;
  };
  return rep(data);
}
module.exports = { resolveRefs };
