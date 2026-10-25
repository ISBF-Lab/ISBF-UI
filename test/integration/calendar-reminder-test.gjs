import { click, fillIn, render } from "@ember/test-helpers";
import { module, test } from "qunit";
import ModalContainer from "discourse/components/modal-container";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import pretender, {
  parsePostData,
  response,
} from "discourse/tests/helpers/create-pretender";
import ISBFCalendarEntryEditor from "../../discourse/components/isbf-calendar-entry-editor";
import ISBFCalendarReminderDialog from "../../discourse/components/isbf-calendar-reminder-dialog";
import ISBFCalendarReminderPicker from "../../discourse/components/isbf-calendar-reminder-picker";

module("ISBF | Integration | calendar reminders", function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    this.owner
      .lookup("service:site")
      .set("isbf_calendar", { reminders: { enabled: true } });
    this.changed = [];
    this.mode = "none";
    this.onChange = (mode) => {
      this.changed.push(mode);
      this.set("mode", mode);
    };
    this.close = () => {};
    this.item = {
      id: 12,
      title: "Official event",
      revision: 4,
      starts_at: "2099-05-14T05:00:00Z",
      ends_at: "2099-05-14T06:00:00Z",
      all_day: false,
    };
  });

  test("selection is staged and past reminders warn without a catch-up request", async function (assert) {
    await render(
      <template>
        <ISBFCalendarReminderPicker
          @mode={{this.mode}}
          @onChange={{this.onChange}}
          @startsAt="2000-01-01T12:00:00Z"
          @timezone="Asia/Shanghai"
        />
      </template>
    );
    await click(".isbf-calendar-reminder__row");
    await click('input[value="before_5m"]');
    assert.deepEqual(this.changed, [], "choosing a radio does not commit");
    await click(".isbf-calendar-reminder__actions .btn-primary");
    assert.deepEqual(
      this.changed,
      ["before_5m"],
      "the past reminder remains configured"
    );
    assert.dom('[role="status"]').exists();
  });

  test("the parent Form retains title, location and notes while selecting a reminder", async function (assert) {
    const modal = this.owner.lookup("service:modal");
    modal.show(ISBFCalendarEntryEditor, {
      model: { selectedDate: "2099-05-14", onSaved() {} },
    });
    await render(<template><ModalContainer /></template>);
    await fillIn('[data-name="title"] input', "Study plan");
    await fillIn('[data-name="location"] input', "Library");
    await fillIn('[data-name="note"] textarea', "Bring notes");
    await click(".isbf-calendar-reminder__row");
    await click('input[value="before_15m"]');
    await click(".isbf-calendar-reminder__actions .btn-primary");
    assert.dom('[data-name="title"] input').hasValue("Study plan");
    assert.dom('[data-name="location"] input').hasValue("Library");
    assert.dom('[data-name="note"] textarea').hasValue("Bring notes");
    let payload;
    pretender.post("/isbf/api/entries.json", (request) => {
      payload = parsePostData(request.requestBody).entry;
      return response({ entry: { id: 88 } });
    });
    await click(".isbf-calendar-entry-editor__save");
    assert.strictEqual(payload.reminder_mode, "before_15m");
    assert.strictEqual(typeof payload.reminder_timezone, "string");
    assert.notStrictEqual(payload.reminder_timezone, "");
    assert.strictEqual(payload.title, "Study plan");
  });

  test("official confirmation is read-only and Cancel makes no request", async function (assert) {
    let requests = 0;
    pretender.post("/isbf/api/official-items/12/add.json", () => {
      requests++;
      return response({ entry: { id: 88 } });
    });
    this.owner.lookup("service:modal").show(ISBFCalendarReminderDialog, {
      model: { item: this.item, onChanged: this.onChange },
    });
    await render(<template><ModalContainer /></template>);
    assert.dom(".isbf-calendar-reminder-dialog h3").hasText("Official event");
    assert
      .dom('.isbf-calendar-reminder-dialog input[type="text"]')
      .doesNotExist();
    await click(".isbf-calendar-reminder-dialog .d-modal__footer .btn-default");
    assert.strictEqual(requests, 0);
  });

  test("official conflicts refresh the source and require a second confirmation", async function (assert) {
    let requests = 0;
    const payloads = [];
    pretender.post("/isbf/api/official-items/12/add.json", (request) => {
      requests++;
      payloads.push(parsePostData(request.requestBody));
      return requests === 1
        ? [
            409,
            { "Content-Type": "application/json" },
            JSON.stringify({ errors: ["changed"] }),
          ]
        : response({ entry: { id: 88, reminder_mode: "before_5m" } });
    });
    pretender.get("/posts/7.json", () =>
      response({
        id: 7,
        isbf_official_calendar_items: [
          { ...this.item, revision: 5, title: "Updated event" },
        ],
      })
    );
    this.owner.lookup("service:modal").show(ISBFCalendarReminderDialog, {
      model: { item: this.item, postId: 7, onChanged: this.onChange },
    });
    await render(<template><ModalContainer /></template>);
    await click(".isbf-calendar-reminder__row");
    await click('input[value="before_5m"]');
    await click(".isbf-calendar-reminder__actions .btn-primary");
    await click(".d-modal__footer .btn-primary");
    assert.strictEqual(requests, 1, "no automatic retry");
    assert.dom(".isbf-calendar-reminder-dialog h3").hasText("Updated event");
    assert.dom('[role="status"]').exists();
    await click(".d-modal__footer .btn-primary");
    assert.strictEqual(requests, 2);
    assert.strictEqual(String(payloads[1].revision), "5");
    assert.strictEqual(payloads[1].reminder_mode, "before_5m");
    assert.strictEqual(payloads[1].reminder_timezone, "Asia/Shanghai");
  });
  test("disabled reminders can be cleared but cannot be enabled", async function (assert) {
    this.mode = "before_15m";
    await render(
      <template>
        <ISBFCalendarReminderPicker
          @mode={{this.mode}}
          @onChange={{this.onChange}}
          @startsAt="2099-01-01T12:00:00Z"
          @timezone="Asia/Shanghai"
          @unavailable={{true}}
        />
      </template>
    );
    await click(".isbf-calendar-reminder__row");
    assert.dom('input[value="before_5m"]').isDisabled();
    assert.dom('input[value="none"]').isNotDisabled();
    await click('input[value="none"]');
    await click(".isbf-calendar-reminder__actions .btn-primary");
    assert.deepEqual(this.changed, ["none"]);
  });
});
