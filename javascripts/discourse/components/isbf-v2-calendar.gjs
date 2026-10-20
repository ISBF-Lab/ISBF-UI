import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { scheduleOnce } from "@ember/runloop";
import { service } from "@ember/service";
import { settings, themePrefix } from "virtual:theme";
import { ajax } from "discourse/lib/ajax";
import { eq } from "discourse/truth-helpers";
import DButton from "discourse/ui-kit/d-button";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import I18n, { i18n } from "discourse-i18n";
import { calendarMonthAnchor, calendarWindow } from "../lib/calendar-window";
import {
  officialDateKey,
  officialOccursOn,
  officialTimeLabel,
} from "../lib/official-calendar";
import ISBFCalendarNoteEditor from "./isbf-calendar-note-editor";
import ISBFCalendarSubscribe from "./isbf-calendar-subscribe";
import ISBFCalendarUpdateDialog from "./isbf-calendar-update-dialog";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDate(key) {
  return new Date(`${key}T12:00:00`);
}

function displayTime(value, allDay) {
  return allDay
    ? i18n(themePrefix("isbf_v2.calendar_all_day"))
    : new Intl.DateTimeFormat(I18n.currentLocale().replace("_", "-"), {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
}

function communityEntries(events) {
  return events.flatMap((event) =>
    (event.occurrences || []).map((occurrence) => {
      const end =
        occurrence.ends_at ||
        (event.all_day
          ? occurrence.starts_at
          : new Date(
              new Date(occurrence.starts_at).getTime() + 3600000
            ).toISOString());
      return {
        id: event.id,
        title: event.name || event.post?.topic?.title,
        starts_at: occurrence.starts_at,
        ends_at: event.all_day
          ? new Date(
              new Date(`${end.slice(0, 10)}T00:00:00.000Z`).getTime() + 86400000
            ).toISOString()
          : end,
        all_day: event.all_day,
        href: event.post?.url,
        kind: "community",
      };
    })
  );
}

export default class ISBFV2Calendar extends Component {
  @service appEvents;
  @service currentUser;
  @service dialog;
  @service modal;
  @service router;

  @tracked visibleMonth;
  @tracked selectedDate;
  @tracked filter = "all";
  @tracked personalEntries = [];
  @tracked communityEvents = [];
  @tracked pendingUpdates = [];
  @tracked updatesError = false;
  @tracked focusedEntryId = null;
  @tracked isLoading = false;
  @tracked loadError = false;
  @tracked isCompact = false;
  @tracked mobileAnchorDay;
  @tracked todayKey;
  @tracked isEditing = false;
  @tracked editingId = null;
  @tracked title = "";
  @tracked note = "";
  @tracked startInput = "";
  @tracked endInput = "";
  @tracked allDay = false;
  @tracked saveError = false;
  weekdays = WEEKDAYS.map((day) => i18n(themePrefix(`isbf_v2.week_${day}`)));

  #requestNumber = 0;
  #updatesRequestNumber = 0;
  #focusRequestNumber = 0;
  #queryEntryId;
  #disposed = false;
  #followingToday = true;
  #mediaQuery;
  #midnightTimer;
  #ownerId;
  #swipe;
  #multiTouch = false;
  #suppressClickUntil = 0;
  #needsCompactProbe = false;
  @tracked _extraWeekMonths = {};

  constructor() {
    super(...arguments);
    const today = new Date();
    this.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this.selectedDate = dateKey(today);
    this.todayKey = this.selectedDate;
    this.mobileAnchorDay = today.getDate();
    this.#ownerId = this.currentUser?.id ?? null;
    this.#mediaQuery = window.matchMedia("(max-width: 600px)");
    this.isCompact = this.#mediaQuery.matches;
    this.#mediaQuery.addEventListener("change", this.onViewportChange);
    window.addEventListener("focus", this.refreshToday);
    document.addEventListener("visibilitychange", this.refreshToday);
    this.#scheduleDayRefresh();
    this.appEvents.on("isbf:calendar-entry-changed", this.reloadEntries);
    this.router.on("routeDidChange", this.focusFromRoute);
    void this.reloadEntries();
    void this.focusFromRoute();
  }

  willDestroy() {
    super.willDestroy(...arguments);
    this.#disposed = true;
    this.#requestNumber++;
    this.#updatesRequestNumber++;
    this.#focusRequestNumber++;
    this.cancelSwipe();
    clearTimeout(this.#midnightTimer);
    this.#mediaQuery.removeEventListener("change", this.onViewportChange);
    window.removeEventListener("focus", this.refreshToday);
    document.removeEventListener("visibilitychange", this.refreshToday);
    this.appEvents.off("isbf:calendar-entry-changed", this.reloadEntries);
    this.router.off("routeDidChange", this.focusFromRoute);
  }

  get monthLabel() {
    return new Intl.DateTimeFormat(I18n.currentLocale().replace("_", "-"), {
      year: "numeric",
      month: "long",
    }).format(this.visibleMonth);
  }

  get selectedLabel() {
    return new Intl.DateTimeFormat(I18n.currentLocale().replace("_", "-"), {
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(localDate(this.selectedDate));
  }

  get canCreateCommunity() {
    return Boolean(
      (this.currentUser?.admin ||
        this.currentUser?.academy_moderator_permissions?.publish_activities) &&
      this.currentUser?.can_create_discourse_post_event &&
      Number(settings.calendar_category_id) > 0
    );
  }

  get communityComposeHref() {
    const slug = settings.calendar_category_path.split("/").filter(Boolean)[1];
    return `/new-topic?category=${encodeURIComponent(slug || "campus-events")}`;
  }

  get viewRange() {
    return calendarWindow(
      this.visibleMonth,
      this.isCompact,
      this.#ownerId === (this.currentUser?.id ?? null) &&
        this._extraWeekMonths[dateKey(this.visibleMonth)] === true
    );
  }

  get fetchRange() {
    return calendarWindow(this.visibleMonth, false);
  }

  get monthCells() {
    const { from, dayCount } = this.viewRange;
    const cells = [];

    for (let index = 0; index < dayCount; index++) {
      const date = new Date(
        from.getFullYear(),
        from.getMonth(),
        from.getDate() + index
      );
      const key = dateKey(date);
      cells.push({
        day: date.getDate(),
        key,
        inMonth:
          date.getFullYear() === this.visibleMonth.getFullYear() &&
          date.getMonth() === this.visibleMonth.getMonth(),
        isSelected: key === this.selectedDate,
        isToday: key === this.todayKey,
        hasPersonal: this.personalEntries.some((entry) =>
          this.#occursOn(entry, key)
        ),
        hasCommunity: this.communityEvents.some((event) =>
          this.#occursOn(event, key)
        ),
      });
    }

    return cells;
  }

  get selectedItems() {
    const entries = this.filter === "community" ? [] : this.personalEntries;
    const events = this.filter === "personal" ? [] : this.communityEvents;
    return [...entries, ...events]
      .filter((item) => this.#occursOn(item, this.selectedDate))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((item) => ({
        ...item,
        isFocused: item.id === this.focusedEntryId && item.kind === "personal",
      }));
  }

  get updatesLabel() {
    return i18n(themePrefix("isbf_v2.schedule_pending_count"), {
      count: this.pendingUpdates.length,
    });
  }

  @action
  reloadEntries() {
    return Promise.all([this.loadMonth(), this.loadUpdates()]);
  }

  @action
  async loadUpdates() {
    const request = ++this.#updatesRequestNumber;
    if (!this.currentUser) {
      return;
    }
    try {
      const { entries } = await ajax("/isbf/api/entry-updates.json");
      if (request === this.#updatesRequestNumber && !this.isDestroying) {
        this.pendingUpdates = entries;
        this.updatesError = false;
      }
    } catch {
      if (request === this.#updatesRequestNumber && !this.isDestroying) {
        this.updatesError = true;
      }
    }
  }

  @action
  async focusFromRoute() {
    const id = new URLSearchParams(this.router.currentURL?.split("?")[1]).get(
      "entry_id"
    );
    if (
      !id ||
      !/^\d+$/.test(id) ||
      Number(id) <= 0 ||
      id === this.#queryEntryId ||
      !this.currentUser
    ) {
      return;
    }
    this.#queryEntryId = id;
    const request = ++this.#focusRequestNumber;
    try {
      const { entry } = await ajax(`/isbf/api/entries/${id}.json`);
      if (request !== this.#focusRequestNumber || this.isDestroying) {
        return;
      }
      this.#selectEntry(entry);
      await this.loadMonth();
      scheduleOnce("afterRender", this, this.#focusEntry);
      if (entry.needs_update) {
        this.reviewUpdate(entry);
      }
    } catch {
      if (!this.isDestroying) {
        this.loadError = true;
      }
    }
  }

  @action
  entryUpdated(entry, accepted = false) {
    if (accepted) {
      this.#selectEntry(entry);
    }
    this.appEvents.trigger("isbf:calendar-entry-changed", entry);
  }

  @action
  reviewUpdate(entry) {
    this.modal.show(ISBFCalendarUpdateDialog, {
      model: {
        entry,
        onChanged: this.entryUpdated,
        onRemove: this.deleteEntry,
      },
    });
  }

  @action
  async loadMonth() {
    this.#syncOwner();
    const request = ++this.#requestNumber;
    const owner = this.#ownerId;
    const month = this.visibleMonth;
    const compact = this.isCompact;
    const { from, to } = this.fetchRange;
    const data = { from: from.toISOString(), to: to.toISOString() };
    const personalData = {
      from: new Date(from.getTime() - 86400000).toISOString(),
      to: new Date(to.getTime() + 86400000).toISOString(),
    };
    this.isLoading = true;
    this.loadError = false;

    const [personal, community] = await Promise.allSettled([
      this.currentUser
        ? ajax("/isbf/api/entries.json", { data: personalData })
        : Promise.resolve({ entries: [] }),
      Number(settings.calendar_category_id) > 0
        ? ajax("/discourse-post-event/events.json", {
            data: {
              after: data.from,
              before: data.to,
              category_id: settings.calendar_category_id,
              limit: 200,
            },
          })
        : Promise.resolve({ events: [] }),
    ]);

    if (!this.#currentRequest(request, owner)) {
      return;
    }

    const entries =
      personal.status === "fulfilled"
        ? personal.value.entries.map((entry) => ({
            ...entry,
            kind: "personal",
          }))
        : [];
    let events =
      community.status === "fulfilled"
        ? communityEntries(community.value.events)
        : [];
    let failed =
      personal.status === "rejected" || community.status === "rejected";
    const sixthWeek = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + 35
    );
    const capped =
      community.status === "fulfilled" && community.value.events.length >= 200;
    let probed = false;
    this.personalEntries = entries;
    this.communityEvents = events;
    if (this.#hasExtraWeek([...entries, ...events], sixthWeek)) {
      this._extraWeekMonths = {
        ...this._extraWeekMonths,
        [dateKey(month)]: true,
      };
    }
    if ((compact || this.isCompact) && capped) {
      try {
        const supplement = await ajax("/discourse-post-event/events.json", {
          data: {
            after: sixthWeek.toISOString(),
            before: data.to,
            category_id: settings.calendar_category_id,
            limit: 200,
          },
        });
        events = [
          ...new Map(
            [...events, ...communityEntries(supplement.events)].map((event) => [
              `${event.id}:${event.starts_at}`,
              event,
            ])
          ).values(),
        ];
        probed = true;
      } catch {
        failed = true;
      }
    }
    if (!this.#currentRequest(request, owner)) {
      return;
    }

    const hasExtraWeek = this.#hasExtraWeek([...entries, ...events], sixthWeek);
    if (hasExtraWeek || !failed) {
      this._extraWeekMonths = {
        ...this._extraWeekMonths,
        [dateKey(month)]: hasExtraWeek,
      };
    }
    this.personalEntries = entries;
    this.communityEvents = events;
    this.#needsCompactProbe = capped && !probed;
    this.loadError = failed;
    this.isLoading = false;
  }

  @action
  previousMonth() {
    this.#changeMonth(-1);
  }

  @action
  nextMonth() {
    this.#changeMonth(1);
  }

  @action
  goToday() {
    this.cancelSwipe();
    const today = new Date();
    this.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this.selectedDate = dateKey(today);
    this.todayKey = this.selectedDate;
    this.mobileAnchorDay = today.getDate();
    this.#followingToday = true;
    this.#scheduleDayRefresh();
    void this.loadMonth();
  }

  @action
  onViewportChange(event) {
    if (
      this.#disposed ||
      this.isDestroying ||
      this.isCompact === event.matches
    ) {
      return;
    }
    const previous = this.fetchRange;
    this.cancelSwipe();
    this.isCompact = event.matches;
    const selected = localDate(this.selectedDate);
    const range = this.viewRange;
    if (selected < range.from || selected >= range.to) {
      this.visibleMonth = new Date(
        selected.getFullYear(),
        selected.getMonth(),
        1
      );
    }
    if (
      previous.from.getTime() !== this.fetchRange.from.getTime() ||
      previous.to.getTime() !== this.fetchRange.to.getTime() ||
      (this.isCompact && this.#needsCompactProbe)
    ) {
      void this.loadMonth();
    }
  }

  @action
  refreshToday() {
    if (
      this.#disposed ||
      this.isDestroying ||
      document.visibilityState === "hidden"
    ) {
      return;
    }
    const today = new Date();
    const key = dateKey(today);
    if (key !== this.todayKey) {
      const selectedToday = this.selectedDate === this.todayKey;
      this.todayKey = key;
      if (this.#followingToday) {
        this.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        this.mobileAnchorDay = today.getDate();
        if (selectedToday) {
          this.selectedDate = key;
        }
        void this.loadMonth();
      }
    }
    this.#scheduleDayRefresh();
  }

  @action
  selectDate(key, event) {
    if (this.#suppressSwipeClick(event)) {
      return;
    }
    this.selectedDate = key;
    if (key !== this.todayKey) {
      this.#followingToday = false;
    }
    const date = localDate(key);
    if (
      date.getMonth() !== this.visibleMonth.getMonth() ||
      date.getFullYear() !== this.visibleMonth.getFullYear()
    ) {
      this.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      void this.loadMonth();
    }
  }

  @action
  setFilter(filter) {
    this.filter = filter;
  }

  @action
  startSwipe(event) {
    if (!this.isCompact || this.#disposed || this.isDestroying) {
      return;
    }
    this.#suppressClickUntil = 0;
    if (event.touches.length !== 1 || this.#multiTouch) {
      this.#swipe = null;
      this.#multiTouch = true;
      return;
    }
    const touch = event.touches[0];
    this.#swipe = {
      x: touch.clientX,
      y: touch.clientY,
      id: touch.identifier,
      month: dateKey(this.visibleMonth),
      owner: this.currentUser?.id ?? null,
    };
  }

  @action
  moveSwipe(event) {
    if (event.touches.length !== 1) {
      this.#swipe = null;
      this.#multiTouch = true;
    }
  }

  @action
  endSwipe(event) {
    if (event.touches.length) {
      this.#swipe = null;
      return;
    }
    const swipe = this.#swipe;
    const blocked = this.#multiTouch;
    this.cancelSwipe();
    if (
      !swipe ||
      blocked ||
      !this.isCompact ||
      this.#disposed ||
      this.isDestroying ||
      swipe.month !== dateKey(this.visibleMonth) ||
      swipe.owner !== (this.currentUser?.id ?? null)
    ) {
      return;
    }
    const touch = [...event.changedTouches].find(
      (item) => item.identifier === swipe.id
    );
    if (!touch) {
      return;
    }
    const dy = touch.clientY - swipe.y;
    const dx = touch.clientX - swipe.x;
    if (Math.abs(dy) >= 48 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      this.#suppressClickUntil = Date.now() + 500;
      this.#changeMonth(dy < 0 ? 1 : -1);
    }
  }

  @action
  cancelSwipe() {
    this.#swipe = null;
    this.#multiTouch = false;
  }

  @action
  newEntry() {
    this.editingId = null;
    this.title = "";
    this.note = "";
    this.startInput = `${this.selectedDate}T09:00`;
    this.endInput = `${this.selectedDate}T10:00`;
    this.allDay = false;
    this.saveError = false;
    this.isEditing = true;
    scheduleOnce("afterRender", this, this.#focusEditor);
  }

  @action
  editEntry(entry) {
    if (entry.source_item_id) {
      this.modal.show(ISBFCalendarNoteEditor, {
        model: { entry, onChanged: this.entryUpdated },
      });
      return;
    }
    this.editingId = entry.id;
    this.title = entry.title;
    this.note = entry.note || "";
    this.allDay = entry.all_day;
    this.startInput = entry.all_day
      ? entry.starts_at.slice(0, 10)
      : this.#localInput(entry.starts_at);
    this.endInput = entry.all_day
      ? new Date(new Date(entry.ends_at).getTime() - 86400000)
          .toISOString()
          .slice(0, 10)
      : this.#localInput(entry.ends_at);
    this.saveError = false;
    this.isEditing = true;
    scheduleOnce("afterRender", this, this.#focusEditor);
  }

  @action
  closeEditor() {
    this.isEditing = false;
  }

  @action
  editorKeydown(event) {
    if (event.key === "Escape") {
      this.closeEditor();
    }
  }

  @action
  updateTitle(event) {
    this.title = event.target.value;
  }

  @action
  updateNote(event) {
    this.note = event.target.value;
  }

  @action
  updateStart(event) {
    this.startInput = event.target.value;
  }

  @action
  updateEnd(event) {
    this.endInput = event.target.value;
  }

  @action
  toggleAllDay(event) {
    this.allDay = event.target.checked;
    this.startInput = this.allDay
      ? this.startInput.slice(0, 10)
      : `${this.startInput.slice(0, 10)}T09:00`;
    this.endInput = this.allDay
      ? this.endInput.slice(0, 10)
      : `${this.endInput.slice(0, 10)}T10:00`;
  }

  @action
  async saveEntry(event) {
    event.preventDefault();
    this.saveError = false;

    let startsAt;
    let endsAt;

    try {
      startsAt = this.allDay
        ? `${this.startInput}T00:00:00.000Z`
        : new Date(this.startInput).toISOString();
      endsAt = this.allDay
        ? new Date(
            new Date(`${this.endInput}T00:00:00.000Z`).getTime() + 86400000
          ).toISOString()
        : new Date(this.endInput).toISOString();
    } catch {
      this.saveError = true;
      return;
    }

    if (!this.title.trim() || endsAt <= startsAt) {
      this.saveError = true;
      return;
    }

    try {
      await ajax(
        this.editingId
          ? `/isbf/api/entries/${this.editingId}.json`
          : "/isbf/api/entries.json",
        {
          type: this.editingId ? "PATCH" : "POST",
          data: {
            entry: {
              title: this.title.trim(),
              note: this.note.trim(),
              starts_at: startsAt,
              ends_at: endsAt,
              all_day: this.allDay,
            },
          },
        }
      );
      this.isEditing = false;
      await this.loadMonth();
    } catch {
      this.saveError = true;
    }
  }

  @action
  async deleteEntry(entry) {
    if (
      !(await this.dialog.confirm({
        message: i18n(themePrefix("isbf_v2.calendar_delete_confirm")),
      }))
    ) {
      return;
    }

    try {
      await ajax(`/isbf/api/entries/${entry.id}.json`, { type: "DELETE" });
      this.appEvents.trigger("isbf:calendar-entry-changed", {
        ...entry,
        removed: true,
      });
      return true;
    } catch {
      this.loadError = true;
      return false;
    }
  }

  #selectEntry(entry) {
    const key = entry.source_item_id
      ? officialDateKey(entry.starts_at)
      : entry.all_day
        ? entry.starts_at.slice(0, 10)
        : dateKey(new Date(entry.starts_at));
    const date = localDate(key);
    this.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    this.selectedDate = key;
    this.#followingToday = false;
    this.focusedEntryId = entry.id;
    this.filter = "all";
  }

  #focusEntry() {
    document.querySelector(".isbf-v2-calendar__item.is-focused")?.focus();
  }

  #changeMonth(amount) {
    this.visibleMonth = new Date(
      this.visibleMonth.getFullYear(),
      this.visibleMonth.getMonth() + amount,
      1
    );
    this.#followingToday = false;
    this.mobileAnchorDay = localDate(this.todayKey).getDate();
    this.selectedDate = dateKey(
      this.isCompact
        ? calendarMonthAnchor(this.visibleMonth, this.mobileAnchorDay)
        : this.visibleMonth
    );
    void this.loadMonth();
  }

  #scheduleDayRefresh() {
    clearTimeout(this.#midnightTimer);
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    );
    this.#midnightTimer = setTimeout(
      this.refreshToday,
      midnight.getTime() - now.getTime() + 50
    );
  }

  #currentRequest(request, owner) {
    return (
      request === this.#requestNumber &&
      owner === (this.currentUser?.id ?? null) &&
      !this.#disposed &&
      !this.isDestroying
    );
  }

  #hasExtraWeek(items, from) {
    return items.some((item) => {
      for (let day = 0; day < 7; day++) {
        const date = new Date(
          from.getFullYear(),
          from.getMonth(),
          from.getDate() + day
        );
        if (this.#occursOn(item, dateKey(date))) {
          return true;
        }
      }
      return false;
    });
  }

  #suppressSwipeClick(event) {
    if (event && event.detail !== 0 && Date.now() < this.#suppressClickUntil) {
      this.#suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  }

  #syncOwner() {
    const owner = this.currentUser?.id ?? null;
    if (owner === this.#ownerId) {
      return;
    }
    this.#ownerId = owner;
    this.#requestNumber++;
    this.#updatesRequestNumber++;
    this.#focusRequestNumber++;
    this.#queryEntryId = null;
    this._extraWeekMonths = {};
    this.personalEntries = [];
    this.communityEvents = [];
    this.pendingUpdates = [];
    this.#needsCompactProbe = false;
    this.cancelSwipe();
  }

  #focusEditor() {
    document
      .querySelector(".isbf-v2-calendar__editor input[type=text]")
      ?.focus();
  }

  #localInput(value) {
    const date = new Date(value);
    return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  #occursOn(item, key) {
    if (item.source_item_id) {
      return officialOccursOn(item, key);
    }
    if (item.all_day) {
      return (
        item.starts_at.slice(0, 10) <= key && key < item.ends_at.slice(0, 10)
      );
    }

    const dayStart = new Date(`${key}T00:00:00`).getTime();
    const nextDay = new Date(
      localDate(key).getFullYear(),
      localDate(key).getMonth(),
      localDate(key).getDate() + 1
    ).getTime();
    return (
      new Date(item.starts_at).getTime() < nextDay &&
      new Date(item.ends_at).getTime() > dayStart
    );
  }

  <template>
    <main class="isbf-v2-feature isbf-v2-calendar">
      <div class="isbf-v2-calendar__heading">
        <div>
          <h1>{{i18n (themePrefix "isbf_v2.calendar")}}</h1>
        </div>
        <div class="isbf-v2-calendar__heading-actions">
          {{#if this.currentUser}}<button
              class="isbf-v2-calendar__primary"
              type="button"
              {{on "click" this.newEntry}}
            >{{dIcon "plus"}}
              {{i18n
                (themePrefix "isbf_v2.calendar_add_personal")
              }}</button>{{/if}}
        </div>
      </div>

      <div
        aria-label={{i18n (themePrefix "isbf_v2.calendar_filter_label")}}
        class="isbf-v2-calendar__filters"
        role="group"
      >
        <button
          class={{if (eq this.filter "all") "is-active"}}
          type="button"
          {{on "click" (fn this.setFilter "all")}}
        >{{i18n (themePrefix "isbf_v2.calendar_all")}}</button>
        {{#if this.currentUser}}<button
            class={{if (eq this.filter "personal") "is-active"}}
            type="button"
            {{on "click" (fn this.setFilter "personal")}}
          >{{i18n (themePrefix "isbf_v2.calendar_personal")}}</button>{{/if}}
        <button
          class={{if (eq this.filter "community") "is-active"}}
          type="button"
          {{on "click" (fn this.setFilter "community")}}
        >{{i18n (themePrefix "isbf_v2.calendar_community")}}</button>
      </div>

      {{#if this.updatesError}}
        <p class="isbf-calendar-updates__error" role="alert">{{i18n
            (themePrefix "isbf_v2.schedule_updates_error")
          }}</p>
        <DButton
          @action={{this.loadUpdates}}
          @label={{themePrefix "isbf_v2.official_retry"}}
        />
      {{/if}}
      {{#if this.pendingUpdates.length}}
        <section aria-label={{this.updatesLabel}} class="isbf-calendar-updates">
          <h2>{{this.updatesLabel}}</h2>
          <p>{{i18n (themePrefix "isbf_v2.schedule_pending_hint")}}</p>
          {{#each this.pendingUpdates key="id" as |entry|}}
            <div class="isbf-calendar-updates__item" data-entry-id={{entry.id}}>
              <span>{{entry.title}}
                ·
                {{i18n
                  (themePrefix
                    (if
                      entry.cancelled
                      "isbf_v2.schedule_cancelled"
                      "isbf_v2.schedule_changed"
                    )
                  )
                }}</span>
              <DButton
                @action={{fn this.reviewUpdate entry}}
                @label={{themePrefix "isbf_v2.schedule_review"}}
              />
            </div>
          {{/each}}
        </section>
      {{/if}}

      <div class="isbf-v2-calendar__layout">
        <section aria-label={{this.monthLabel}} class="isbf-v2-calendar__month">
          <div class="isbf-v2-calendar__month-toolbar">
            <h2>{{this.monthLabel}}</h2>
            <div>
              <button type="button" {{on "click" this.goToday}}>{{i18n
                  (themePrefix "isbf_v2.calendar_today")
                }}</button>
              <button
                aria-label={{i18n (themePrefix "isbf_v2.calendar_previous")}}
                type="button"
                {{on "click" this.previousMonth}}
              >{{dIcon "chevron-left"}}</button>
              <button
                aria-label={{i18n (themePrefix "isbf_v2.calendar_next")}}
                type="button"
                {{on "click" this.nextMonth}}
              >{{dIcon "chevron-right"}}</button>
            </div>
          </div>
          <div class="isbf-v2-calendar__weekdays">{{#each
              this.weekdays
              as |day|
            }}<span>{{day}}</span>{{/each}}</div>
          <div
            class="isbf-v2-calendar__days"
            {{on "touchstart" this.startSwipe passive=true}}
            {{on "touchmove" this.moveSwipe passive=true}}
            {{on "touchend" this.endSwipe passive=true}}
            {{on "touchcancel" this.cancelSwipe passive=true}}
          >
            {{#each this.monthCells as |cell|}}
              <button
                aria-label={{cell.key}}
                aria-pressed={{if cell.isSelected "true" "false"}}
                class="isbf-v2-calendar__day
                  {{if cell.inMonth '' 'is-outside'}}
                  {{if cell.isSelected 'is-selected'}}
                  {{if cell.isToday 'is-today'}}"
                type="button"
                {{on "click" (fn this.selectDate cell.key)}}
              >
                <span>{{cell.day}}</span><span
                  aria-hidden="true"
                  class="isbf-v2-calendar__dots"
                >{{#if cell.hasPersonal}}<i class="is-personal"></i>{{/if}}{{#if
                    cell.hasCommunity
                  }}<i class="is-community"></i>{{/if}}</span>
              </button>
            {{/each}}
          </div>
          <div class="isbf-v2-calendar__month-footer">
            <div class="isbf-v2-calendar__legend"><span><i
                  class="is-personal"
                ></i>{{i18n
                  (themePrefix "isbf_v2.calendar_personal")
                }}</span><span><i class="is-community"></i>{{i18n
                  (themePrefix "isbf_v2.calendar_community")
                }}</span></div>
            <ISBFCalendarSubscribe />
          </div>
        </section>

        <section
          aria-label={{this.selectedLabel}}
          class="isbf-v2-calendar__agenda"
        >
          <div class="isbf-v2-calendar__agenda-heading"><div><small>{{i18n
                  (themePrefix "isbf_v2.calendar_selected")
                }}</small><h2>{{this.selectedLabel}}</h2></div>{{#if
              this.canCreateCommunity
            }}<a href={{this.communityComposeHref}}>{{i18n
                  (themePrefix "isbf_v2.calendar_publish_event")
                }}</a>{{/if}}</div>
          {{#if this.isLoading}}<p class="isbf-v2-calendar__empty">{{i18n
                (themePrefix "isbf_v2.calendar_loading")
              }}</p>{{/if}}
          {{#if this.loadError}}
            <p class="isbf-v2-calendar__error" role="alert">{{i18n
                (themePrefix "isbf_v2.calendar_load_error")
              }}</p>
            <DButton
              @action={{this.loadMonth}}
              @disabled={{this.isLoading}}
              @label={{themePrefix "isbf_v2.official_retry"}}
            />
          {{/if}}
          {{#unless this.isLoading}}
            {{#each this.selectedItems as |item|}}
              <article
                class="isbf-v2-calendar__item isbf-v2-calendar__item--{{item.kind}}
                  {{if item.isFocused 'is-focused'}}"
                data-entry-id={{item.id}}
                tabindex={{if item.isFocused "-1"}}
              >
                <div class="isbf-v2-calendar__item-top"><span>{{if
                      (eq item.kind "personal")
                      (i18n (themePrefix "isbf_v2.calendar_personal"))
                      (i18n (themePrefix "isbf_v2.calendar_community"))
                    }}</span><time>{{#if
                      item.source_item_id
                    }}{{officialTimeLabel item}}{{else}}{{displayTime
                        item.starts_at
                        item.all_day
                      }}{{/if}}</time></div>
                {{#if item.href}}<h3><a
                      href={{item.href}}
                    >{{item.title}}</a></h3>{{else}}<h3
                  >{{item.title}}</h3>{{/if}}
                {{#if item.note}}<p>{{item.note}}</p>{{/if}}
                {{#if item.source_item_id}}
                  <div class="isbf-v2-calendar__official">
                    <span>{{i18n
                        (themePrefix "isbf_v2.schedule_imported")
                      }}</span>
                    {{#if item.cancelled}}<strong>{{i18n
                          (themePrefix "isbf_v2.schedule_cancelled")
                        }}</strong>{{/if}}
                    {{#if item.source_url}}<a href={{item.source_url}}>{{i18n
                          (themePrefix "isbf_v2.schedule_source")
                        }}</a>{{else if item.source_unavailable}}<span>{{i18n
                          (themePrefix "isbf_v2.schedule_unavailable")
                        }}</span>{{/if}}
                    {{#if item.needs_update}}<DButton
                        @action={{fn this.reviewUpdate item}}
                        @label={{themePrefix "isbf_v2.schedule_review"}}
                      />{{/if}}
                  </div>
                {{/if}}
                {{#if (eq item.kind "personal")}}<div
                    class="isbf-v2-calendar__item-actions"
                  ><button
                      type="button"
                      {{on "click" (fn this.editEntry item)}}
                    >{{i18n
                        (themePrefix
                          (if
                            item.source_item_id
                            "isbf_v2.schedule_edit_note"
                            "isbf_v2.calendar_edit"
                          )
                        )
                      }}</button><button
                      type="button"
                      {{on "click" (fn this.deleteEntry item)}}
                    >{{i18n
                        (themePrefix "isbf_v2.calendar_delete")
                      }}</button></div>{{/if}}
              </article>
            {{else}}
              <p class="isbf-v2-calendar__empty">{{i18n
                  (themePrefix "isbf_v2.calendar_empty")
                }}</p>
            {{/each}}
          {{/unless}}
        </section>
      </div>

      {{#if this.isEditing}}
        <div
          aria-label={{i18n (themePrefix "isbf_v2.calendar_personal")}}
          aria-modal="true"
          class="isbf-v2-calendar__editor-backdrop"
          role="dialog"
          tabindex="-1"
          {{on "keydown" this.editorKeydown}}
        >
          <form class="isbf-v2-calendar__editor" {{on "submit" this.saveEntry}}>
            <div class="isbf-v2-calendar__editor-heading"><h2>{{i18n
                  (themePrefix "isbf_v2.calendar_personal")
                }}</h2><button
                aria-label={{i18n (themePrefix "isbf_v2.calendar_close")}}
                type="button"
                {{on "click" this.closeEditor}}
              >{{dIcon "xmark"}}</button></div>
            <label>{{i18n (themePrefix "isbf_v2.calendar_title")}}<input
                maxlength="120"
                required
                type="text"
                value={{this.title}}
                {{on "input" this.updateTitle}}
              /></label>
            <label class="isbf-v2-calendar__checkbox"><input
                checked={{this.allDay}}
                type="checkbox"
                {{on "change" this.toggleAllDay}}
              />{{i18n (themePrefix "isbf_v2.calendar_all_day")}}</label>
            <div class="isbf-v2-calendar__form-dates"><label>{{i18n
                  (themePrefix "isbf_v2.calendar_start")
                }}<input
                  required
                  type={{if this.allDay "date" "datetime-local"}}
                  value={{this.startInput}}
                  {{on "input" this.updateStart}}
                /></label><label>{{i18n
                  (themePrefix "isbf_v2.calendar_end")
                }}<input
                  required
                  type={{if this.allDay "date" "datetime-local"}}
                  value={{this.endInput}}
                  {{on "input" this.updateEnd}}
                /></label></div>
            <label>{{i18n (themePrefix "isbf_v2.calendar_note")}}<textarea
                maxlength="2000"
                rows="3"
                value={{this.note}}
                {{on "input" this.updateNote}}
              ></textarea></label>
            {{#if this.saveError}}<p
                class="isbf-v2-calendar__error"
                role="alert"
              >{{i18n (themePrefix "isbf_v2.calendar_save_error")}}</p>{{/if}}
            <div class="isbf-v2-calendar__form-actions"><button
                type="button"
                {{on "click" this.closeEditor}}
              >{{i18n (themePrefix "isbf_v2.calendar_cancel")}}</button><button
                class="isbf-v2-calendar__primary"
                type="submit"
              >{{i18n (themePrefix "isbf_v2.calendar_save")}}</button></div>
          </form>
        </div>
      {{/if}}
    </main>
  </template>
}
