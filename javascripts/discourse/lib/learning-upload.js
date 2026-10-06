import getURL from "discourse/lib/get-url";
import { UploadPreProcessorPlugin } from "discourse/lib/uppy-plugin-base";
import { isLearningComposer } from "./learning-composer";

export default class LearningUpload extends UploadPreProcessorPlugin {
  static pluginId = "isbf-learning-private-upload";

  #nativeEndpoint;
  #process;

  constructor(uppy, options) {
    super(uppy, options);
    this.#process = this.process.bind(this);
  }

  install() {
    this._install(this.#process);
  }

  uninstall() {
    this._uninstall(this.#process);
  }

  process(ids) {
    const uploader = this.uppy.getPlugin("XHRUpload");
    const learning = isLearningComposer(this.opts.composerModel);
    if (learning && !uploader) {
      throw new Error(
        "Private learning uploads require the authenticated upload transport.",
      );
    }
    if (uploader) {
      this.#nativeEndpoint ??= uploader.opts.endpoint;
      uploader.setOptions({
        endpoint: learning
          ? getURL("/isbf/learning/uploads.json")
          : this.#nativeEndpoint,
      });
    }
    if (learning && !this.opts.composerModel.isbf_learning_course_id) {
      throw new Error("请先选择课程，再上传资料。");
    }
    return this._emitAllComplete(ids, true);
  }
}
