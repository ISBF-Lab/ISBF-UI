export function learningConfig(site) {
  const config = site?.isbf_learning;
  return Number.isSafeInteger(config?.category_id) &&
    config.category_id > 0 &&
    Array.isArray(config.grades) &&
    [1, 2, 3, 4].every((id) =>
      config.grades.some(
        (grade) => grade.id === id && typeof grade.label === "string",
      ),
    )
    ? config
    : null;
}

export function learningResourceQuery(courseId, query, page = 0) {
  return query.trim()
    ? { q: query.trim(), page }
    : { course_id: courseId, page };
}

export function learningFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) {
    return "";
  }
  return size >= 1048576
    ? `${(size / 1048576).toFixed(1)} MB`
    : `${Math.ceil(size / 1024)} KB`;
}

export function learningSafeUrl(value) {
  if (typeof value !== "string" || /[\\\u0000-\u0020]/.test(value)) {
    return null;
  }
  return /^(https?:\/\/|\/(?!\/))/i.test(value) ? value : null;
}
