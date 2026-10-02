const queue = [];
let activeRequests = 0;

function runJob(job) {
  activeRequests += 1;
  Promise.resolve()
    .then(job.work)
    .then(job.resolve, job.reject)
    .finally(() => {
      activeRequests -= 1;
      runQueue();
    });
}

function runQueue() {
  while (activeRequests < 2 && queue.length) {
    const job = queue.shift();
    if (!job.isCurrent()) {
      job.resolve(null);
      continue;
    }
    runJob(job);
  }
}

export function enqueueExploreQuery(work, isCurrent = () => true) {
  return new Promise((resolve, reject) => {
    queue.push({ isCurrent, reject, resolve, work });
    runQueue();
  });
}

export function categoryFilterPath(category, categories) {
  const parts = [];
  const visited = new Set();
  let current = category;
  while (current) {
    if (!current.slug || visited.has(Number(current.id))) {
      return null;
    }
    visited.add(Number(current.id));
    parts.unshift(current.slug);
    const parentId = current.parent_category_id;
    current = parentId
      ? categories.find((item) => Number(item.id) === Number(parentId))
      : null;
  }
  return parts.join(":");
}

export function buildExploreQuery({
  categoryPath,
  tags = [],
  order = "activity",
}) {
  const clauses = [];
  if (categoryPath) {
    clauses.push(`=category:${categoryPath}`);
  }
  if (tags.length) {
    clauses.push(`tag:${[...new Set(tags)].join(",")}`);
  }
  clauses.push(`order:${order === "hot" ? "hot" : "activity"}`);
  return clauses.join(" ");
}

export function uniqueTopicList(topics) {
  const seen = new Set();
  return Array.from(topics || []).filter((topic) => {
    if (seen.has(topic.id)) {
      return false;
    }
    seen.add(topic.id);
    return true;
  });
}
