import { ajax } from "discourse/lib/ajax";

const counts = new Map();
const requests = new Map();
const pendingKeys = new Set();
let timer;

async function flush() {
  const keys = [...pendingKeys].slice(0, 50);
  keys.forEach((key) => pendingKeys.delete(key));
  timer = null;

  try {
    const result = await ajax("/isbf/views/impressions", {
      data: { topic_ids: keys.map((key) => requests.get(key).topicId) },
      type: "POST",
    });

    keys.forEach((key) => {
      const request = requests.get(key);
      const value = result.counts?.[request.topicId];
      const count = value === undefined ? null : Number(value);
      if (count !== null && Number.isFinite(count)) {
        counts.set(key, count);
      }
      request.resolve(Number.isFinite(count) ? count : null);
      requests.delete(key);
    });
  } catch {
    keys.forEach((key) => {
      requests.get(key)?.resolve(null);
      requests.delete(key);
    });
  }

  if (pendingKeys.size) {
    timer = setTimeout(flush, 40);
  }
}

export function recordVisibleView(topicId, userId) {
  const key = userId + ":" + topicId;
  if (counts.has(key)) {
    return Promise.resolve(counts.get(key));
  }
  if (requests.has(key)) {
    return requests.get(key).promise;
  }

  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  requests.set(key, { promise, resolve, topicId });
  pendingKeys.add(key);
  timer ??= setTimeout(flush, 40);
  return promise;
}
