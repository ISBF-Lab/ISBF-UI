import { ajax } from "discourse/lib/ajax";

const cache = new Map();
const queue = [];
let activeRequests = 0;

function runQueue() {
  while (activeRequests < 4 && queue.length) {
    const job = queue.shift();
    activeRequests += 1;
    ajax(`/posts/${job.postId}/cooked`)
      .then((result) => {
        cache.set(job.postId, result.cooked);
        job.resolve(result.cooked);
      })
      .catch(job.reject)
      .finally(() => {
        activeRequests -= 1;
        runQueue();
      });
  }
}

export function loadCookedPost(postId) {
  if (cache.has(postId)) {
    return Promise.resolve(cache.get(postId));
  }

  return new Promise((resolve, reject) => {
    queue.push({ postId, reject, resolve });
    runQueue();
  });
}

const countCache = new Map();
const pendingCountIds = new Set();
const countResolvers = new Map();
let countTimer;

async function flushCounts() {
  const ids = [...pendingCountIds].slice(0, 50);
  ids.forEach((id) => pendingCountIds.delete(id));
  countTimer = null;

  try {
    const result = await ajax("/isbf/reposts/counts", {
      data: { topic_ids: ids },
    });
    ids.forEach((id) => {
      const count = Number(result.counts?.[id] ?? 0);
      countCache.set(id, count);
      countResolvers.get(id)?.forEach((resolve) => resolve(count));
      countResolvers.delete(id);
    });
  } catch {
    ids.forEach((id) => {
      countResolvers.get(id)?.forEach((resolve) => resolve(null));
      countResolvers.delete(id);
    });
  }

  if (pendingCountIds.size) {
    countTimer = setTimeout(flushCounts, 40);
  }
}

export function loadRepostCount(topicId) {
  if (countCache.has(topicId)) {
    return Promise.resolve(countCache.get(topicId));
  }

  pendingCountIds.add(topicId);
  return new Promise((resolve) => {
    const resolvers = countResolvers.get(topicId) ?? [];
    resolvers.push(resolve);
    countResolvers.set(topicId, resolvers);
    countTimer ??= setTimeout(flushCounts, 40);
  });
}
