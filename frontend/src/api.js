// Same origin in production (FastAPI serves the build); proxied by Vite in development.
const BASE = import.meta.env.VITE_API_BASE || "";

async function parse(res) {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const getMeta = () => fetch(`${BASE}/api/meta`).then(parse);

export const predict = (body, signal) =>
  fetch(`${BASE}/api/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).then(parse);

export const getTop = (params, signal) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== "" && v != null) q.set(k, v);
  });
  return fetch(`${BASE}/api/top?${q}`, { signal }).then(parse);
};
