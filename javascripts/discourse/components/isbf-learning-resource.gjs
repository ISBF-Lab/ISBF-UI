import Component from "@glimmer/component";
import { themePrefix } from "virtual:theme";
import dAvatar from "discourse/ui-kit/helpers/d-avatar";
import { i18n } from "discourse-i18n";
import { learningFileSize, learningSafeUrl } from "../lib/learning-resources";

export default class ISBFLearningResource extends Component {
  get createdAtLabel() {
    const date = new Date(this.args.resource.created_at);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
        }).format(date);
  }

  get files() {
    return (this.args.resource.files || []).flatMap((file) => {
      const url = learningSafeUrl(file.url);
      return url
        ? [{ ...file, url, sizeLabel: learningFileSize(file.size) }]
        : [];
    });
  }

  get gradeLabel() {
    return this.args.grades.find(
      (grade) => grade.id === this.args.resource.grade,
    )?.label;
  }

  get links() {
    return (this.args.resource.links || [])
      .map(learningSafeUrl)
      .filter(Boolean);
  }

  get topicUrl() {
    return learningSafeUrl(this.args.resource.url);
  }

  <template>
    <article class="isbf-learning-resource">
      <div class="isbf-learning-resource__author">
        {{#if @resource.author.avatar_template}}
          {{dAvatar @resource.author imageSize="small"}}
        {{/if}}
        <span>{{if
            @resource.author.name
            @resource.author.name
            @resource.author.username
          }}</span>
        <time datetime={{@resource.created_at}}>{{this.createdAtLabel}}</time>
      </div>
      <h3><a href={{this.topicUrl}}>{{@resource.title}}</a></h3>
      {{#if @searching}}<p
          class="isbf-learning-resource__context"
        >{{this.gradeLabel}} · {{@resource.course.name}}</p>{{/if}}
      {{#if @resource.description}}<p
          class="isbf-learning-resource__description"
        >{{@resource.description}}</p>{{/if}}
      {{#if this.files.length}}
        <ul
          aria-label={{i18n (themePrefix "isbf_v2.learning_files")}}
          class="isbf-learning-resource__attachments"
        >
          {{#each this.files as |file|}}<li><a
                href={{file.url}}
              >{{file.name}}</a><span>{{file.sizeLabel}}</span></li>{{/each}}
        </ul>
      {{/if}}
      {{#if this.links.length}}
        <ul
          aria-label={{i18n (themePrefix "isbf_v2.learning_links")}}
          class="isbf-learning-resource__attachments"
        >
          {{#each this.links as |url|}}<li><a
                href={{url}}
                rel="noopener noreferrer"
                target="_blank"
              >{{url}}</a></li>{{/each}}
        </ul>
      {{/if}}
    </article>
  </template>
}
