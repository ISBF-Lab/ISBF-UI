import { ajax } from "discourse/lib/ajax";

const cache = new Map();
const pendingRequests = new Map();
const invalidatedPosts = new Set();
const generations = new Map();
const queue = [];
const pollCache = new Map();
const pendingPolls = new Map();
let activeRequests = 0;

function runQueue() {
  while (activeRequests < 4 && queue.length) {
    activeRequests += 1;
    runJob(queue.shift());
  }
}

function runJob(job) {
  const isPoll = job.kind === "polls";
  const { generation, postId } = job;
  ajax(isPoll ? `/posts/${postId}.json` : `/posts/${postId}/cooked`)
    .then((result) => {
      if (
        invalidatedPosts.has(postId) ||
        generation !== generations.get(postId)
      ) {
        job.resolve(isPoll ? null : "");
      } else if (isPoll) {
        pollCache.set(job.key, { value: result, at: Date.now() });
        if (pollCache.size > 100) {
          pollCache.delete(pollCache.keys().next().value);
        }
        job.resolve(result);
      } else {
        cache.set(postId, result.cooked);
        if (cache.size > 50) {
          cache.delete(cache.keys().next().value);
        }
        job.resolve(result.cooked);
      }
    })
    .catch(job.reject)
    .finally(() => {
      if (!isPoll && pendingRequests.get(postId)?.promise === job.promise) {
        pendingRequests.delete(postId);
      }
      activeRequests -= 1;
      runQueue();
    });
}

export function loadCookedPost(postId) {
  postId = Number(postId);
  if (invalidatedPosts.has(postId)) {
    return Promise.resolve("");
  }
  if (cache.has(postId)) {
    const cooked = cache.get(postId);
    cache.delete(postId);
    cache.set(postId, cooked);
    return Promise.resolve(cooked);
  }
  const generation = generations.get(postId);
  const pending = pendingRequests.get(postId);
  if (pending && pending.generation === generation) {
    return pending.promise;
  }
  const job = { generation, postId };
  job.promise = new Promise((resolve, reject) => {
    Object.assign(job, { reject, resolve });
  });
  pendingRequests.set(postId, job);
  queue.push(job);
  runQueue();
  return job.promise;
}

export function loadPostPolls(postId, userId, { refresh = false } = {}) {
  const id = Number(postId);
  if (!Number.isSafeInteger(id) || id <= 0 || invalidatedPosts.has(id)) {
    return Promise.resolve(null);
  }
  const key = `${userId || "guest"}:${id}`;
  if (pendingPolls.has(key)) {
    return pendingPolls.get(key);
  }
  const cached = pollCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < 30000) {
    return Promise.resolve(cached.value);
  }
  pollCache.delete(key);
  const promise = new Promise((resolve, reject) => {
    queue.push({
      kind: "polls",
      key,
      postId: id,
      reject,
      resolve,
      generation: generations.get(id),
    });
    runQueue();
  }).finally(() => {
    if (pendingPolls.get(key) === promise) {
      pendingPolls.delete(key);
    }
  });
  pendingPolls.set(key, promise);
  return promise;
}

export function invalidateCookedPost(postId, hidden = true) {
  const id = Number(postId);
  generations.set(id, (generations.get(id) || 0) + 1);
  if (hidden) {
    invalidatedPosts.add(id);
  } else {
    invalidatedPosts.delete(id);
  }
  cache.delete(id);
  for (const key of pollCache.keys()) {
    if (key.endsWith(`:${id}`)) {
      pollCache.delete(key);
    }
  }
  for (const key of pendingPolls.keys()) {
    if (key.endsWith(`:${id}`)) {
      pendingPolls.delete(key);
    }
  }
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
