// Browser-local, per-tab workspace. No account or remote collection of choices.
let dbPromise;
function database() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("hrh-workforce-lab", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspaces");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export function participantKey(release) {
  let id;
  try {
    id = sessionStorage.getItem("lab.participant");
    if (!id) sessionStorage.setItem("lab.participant", id = crypto.randomUUID());
  } catch { id = crypto.randomUUID(); }
  return `${release}:${id}`;
}
export async function readWorkspace(key) {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const req = db.transaction("workspaces").objectStore("workspaces").get(key);
      req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}
export async function writeWorkspace(key, value) {
  try {
    const db = await database();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("workspaces", "readwrite");
      tx.objectStore("workspaces").put(structuredClone(value), key);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
}
