import { apiInitializer } from "discourse/lib/api";
import Composer from "discourse/models/composer";
import ISBFLearningComposer from "../components/isbf-learning-composer";
import {
  isLearningComposer,
  LEARNING_FIELDS,
  learningFileIds,
  learningPayload,
  restoreLearning,
} from "../lib/learning-composer";
import LearningUpload from "../lib/learning-upload";

export default apiInitializer((api) => {
  api.registerReviewableComponent(
    "ReviewableIsbfLearningCourse",
    async () =>
      (await import("../components/reviewable-isbf-learning-course")).default,
  );

  for (const [index, field] of LEARNING_FIELDS.entries()) {
    const property = index
      ? "isbfLearningFilesPayload"
      : "isbfLearningCoursePayload";
    Composer.serializeOnCreate(field, property);
    Composer.serializeOnUpdate(field, property);
    Composer.serializeToDraft(field, field);
  }

  api.modifyClass("model:composer", {
    pluginId: "isbf-ui-learning-resources",

    get isbfLearningCoursePayload() {
      return learningPayload(this, LEARNING_FIELDS[0]);
    },

    get isbfLearningFilesPayload() {
      return learningPayload(this, LEARNING_FIELDS[1]);
    },

    clearState() {
      this._super(...arguments);
      this.setProperties({
        isbf_learning_course_id: null,
        isbf_learning_files: null,
      });
    },

    open(options = {}) {
      return this._super(...arguments).then((result) => {
        restoreLearning(this, options);
        return result;
      });
    },

    save() {
      if (
        isLearningComposer(this) &&
        (!this.title?.trim() ||
          this.title.includes("[isbf-untitled:") ||
          !this.isbf_learning_course_id)
      ) {
        return Promise.resolve(this.dialog.alert("请填写资料标题并选择课程。"));
      }
      return this._super(...arguments);
    },
  });

  api.renderInOutlet("before-composer-fields", ISBFLearningComposer);
  api.addComposerUploadPreProcessor(LearningUpload, ({ composerModel }) => ({
    composerModel,
  }));
  api.addComposerUploadMarkdownResolver((upload) => {
    if (!/^\/isbf\/learning\/files\/[a-f0-9-]{36}$/.test(upload.url || "")) {
      return;
    }
    const model = api.container.lookup("service:composer").model;
    if (!isLearningComposer(model)) {
      return;
    }
    model.set(
      "isbf_learning_files",
      JSON.stringify([
        ...new Set([...learningFileIds(model.isbf_learning_files), upload.id]),
      ]),
    );
    const name = upload.original_filename.replace(/[\[\]|\n\r]/g, "");
    return `[${name}](${upload.url})`;
  });
});
