import { iconElement } from "discourse/lib/icon-library";

const SPEED = 1.2;
const DILATE = 190 / SPEED;
const HANDOFF = 150 / SPEED;
const LANDING = HANDOFF + 300 / SPEED;
const DURATION = LANDING + 160 / SPEED;
const SQUASH = 3;

function easeOut(progress) {
  if (progress <= 0 || progress >= 1) {
    return Math.min(1, Math.max(0, progress));
  }
  const curve = (t, a, b) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let lower = 0;
  let upper = 1;
  for (let i = 0; i < 14; i++) {
    const middle = (lower + upper) / 2;
    if (curve(middle, 0.23, 0.32) < progress) {
      lower = middle;
    } else {
      upper = middle;
    }
  }
  return curve((lower + upper) / 2, 1, 1);
}

function spring(progress) {
  const t = Math.min(1, Math.max(0, progress));
  return (1 - (1 + 8 * t) * Math.exp(-8 * t)) / (1 - 9 * Math.exp(-8));
}

const ICONS = {
  summary: "summary",
  activity: "activity",
  notifications: "notifications",
  "personal-messages": "messages",
  invites: "invited",
  badges: "badges",
  preferences: "preferences",
};

export default class ProfileNavigation {
  #element;
  #list;
  #controls;
  #indicator;
  #fill;
  #mutationObserver;
  #resizeObserver;
  #motion = matchMedia("(prefers-reduced-motion: reduce)");
  #animation;
  #fillAnimation;
  #animateSelection = false;
  #frame;
  #geometry;
  #canvas;
  #radius;
  #active;
  #icons = new Set();

  #selectionChanged = () => {
    this.#schedule(true);
  };

  #layoutChanged = () => {
    this.#schedule(false);
  };

  constructor(element) {
    this.#element = element;
    this.#list = element.querySelector("ul.nav-pills");
    this.#controls = this.#list.closest(".d-overflow-controls");
    this.#indicator = document.createElement("span");
    this.#indicator.className = "isbf-profile-nav__indicator";
    this.#indicator.setAttribute("aria-hidden", "true");
    this.#fill = document.createElement("span");
    this.#fill.className = "isbf-profile-nav__fill";
    this.#indicator.append(this.#fill);
    this.#controls.append(this.#indicator);
    element.classList.add("isbf-profile-navigation");
    this.#mutationObserver = new MutationObserver(this.#selectionChanged);
    this.#mutationObserver.observe(this.#list, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    this.#resizeObserver = new ResizeObserver(this.#layoutChanged);
    this.#resizeObserver.observe(this.#controls);
    this.#resizeObserver.observe(this.#list);
    this.#list.addEventListener("scroll", this.#layoutChanged, {
      passive: true,
    });
    this.#motion.addEventListener("change", this.#layoutChanged);
    this.#sync(false);
  }

  destroy() {
    cancelAnimationFrame(this.#frame);
    this.#cancelAnimations();
    this.#mutationObserver.disconnect();
    this.#resizeObserver.disconnect();
    this.#list.removeEventListener("scroll", this.#layoutChanged);
    this.#motion.removeEventListener("change", this.#layoutChanged);
    this.#indicator.remove();
    for (const icon of this.#icons) {
      icon.remove();
    }
    this.#element.classList.remove(
      "isbf-profile-navigation",
      "--indicator-ready"
    );
  }

  #cancelAnimations() {
    this.#animation?.cancel();
    this.#fillAnimation?.cancel();
    this.#animation = null;
    this.#fillAnimation = null;
  }

  #clip({ x, y, width, height }, inset = 0) {
    const radius = Math.max(
      0,
      Math.min(this.#radius, width / 2, height / 2) - inset
    );
    return `inset(${y + inset}px ${this.#canvas.width - x - width + inset}px ${this.#canvas.height - y - height + inset}px ${x + inset}px round ${radius}px)`;
  }

  #visibleGeometry(clipPath) {
    const match = clipPath.match(/^inset\((.*?)\s+round\s/);
    if (!match) {
      return null;
    }
    const edges = match[1].split(/\s+/).map(Number.parseFloat);
    const [top, right = top, bottom = top, left = right] = edges;
    return {
      x: left,
      y: top,
      width: this.#canvas.width - left - right,
      height: this.#canvas.height - top - bottom,
    };
  }

  #schedule(animate) {
    this.#animateSelection ||= animate;
    if (this.#frame) {
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = null;
      const transition = this.#animateSelection;
      this.#animateSelection = false;
      this.#sync(transition);
    });
  }

  #sync(animate) {
    if (this.#element.classList.contains("user-navigation-primary")) {
      for (const [item, icon] of Object.entries(ICONS)) {
        const link = this.#list.querySelector(`.user-nav__${item} > a`);
        if (link && !link.querySelector(".isbf-profile-nav__icon")) {
          const node = iconElement(`isbf-profile-${icon}`, {
            class: "isbf-profile-nav__icon",
          });
          link.prepend(node);
          this.#icons.add(node);
        }
      }
    }

    const active = this.#list.querySelector("a.active");
    const target = active?.getBoundingClientRect();
    if (!target?.width || !target.height) {
      this.#cancelAnimations();
      this.#indicator.hidden = true;
      this.#element.classList.remove("--indicator-ready");
      this.#active = null;
      this.#geometry = null;
      return;
    }

    this.#indicator.hidden = false;
    const origin = this.#indicator.getBoundingClientRect();
    const style = getComputedStyle(this.#indicator);
    this.#canvas = {
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
    const previous = this.#active && this.#visibleGeometry(style.clipPath);
    const scaleX = origin.width / this.#canvas.width || 1;
    const scaleY = origin.height / this.#canvas.height || 1;
    const x = (target.x - origin.x) / scaleX;
    const y = (target.y - origin.y) / scaleY;
    const width = target.width / scaleX;
    const height = target.height / scaleY;
    const geometry = [
      x,
      y,
      width,
      height,
      this.#canvas.width,
      this.#canvas.height,
    ];
    if (
      this.#active === active &&
      geometry.every((value, index) => value === this.#geometry?.[index]) &&
      !(
        this.#motion.matches &&
        ["running", "paused"].includes(this.#animation?.playState)
      )
    ) {
      return;
    }
    this.#cancelAnimations();
    const radius = Number.parseFloat(
      style.getPropertyValue("--isbf-v2-radius-pill")
    );
    this.#radius = Number.isFinite(radius) ? radius : height / 2;
    const destination = { x, y, width, height };
    const inset = this.#element.classList.contains("user-navigation-secondary")
      ? 1
      : 0;
    this.#indicator.style.clipPath = this.#clip(destination);
    this.#indicator.style.setProperty("--profile-nav-indicator-top", `${y}px`);
    this.#fill.style.clipPath = this.#clip(destination, inset);
    this.#element.classList.add("--indicator-ready");

    if (
      animate &&
      this.#active &&
      this.#active !== active &&
      previous?.width &&
      !this.#motion.matches
    ) {
      this.#transition(previous, destination, inset);
    }
    this.#active = active;
    this.#geometry = geometry;
  }

  #transition(from, to, inset) {
    const start = [from.x, from.x + from.width, from.y, from.height];
    const finish = [to.x, to.x + to.width, to.y, to.height];
    const stretch = [
      Math.min(start[0], finish[0]),
      Math.max(start[1], finish[1]),
      to.y,
      to.height,
    ];
    const blend = (a, b, progress) =>
      a.map((value, index) => value + (b[index] - value) * progress);
    const handoff = blend(start, stretch, easeOut(HANDOFF / DILATE));
    const forward = finish[0] + finish[1] >= start[0] + start[1];
    const landing = [...finish];
    const squash = Math.min(SQUASH, Math.max(0, to.width - to.height));
    landing[forward ? 0 : 1] += forward ? squash : -squash;
    const times = new Set([0, HANDOFF, LANDING, DURATION]);
    for (let time = 1000 / 120; time < DURATION; time += 1000 / 120) {
      times.add(time);
    }
    const frames = [];
    const fills = [];
    for (const time of [...times].sort((a, b) => a - b)) {
      const edges =
        time <= HANDOFF
          ? blend(start, stretch, easeOut(time / DILATE))
          : time <= LANDING
            ? blend(
                handoff,
                landing,
                spring((time - HANDOFF) / (LANDING - HANDOFF))
              )
            : blend(
                landing,
                finish,
                spring((time - LANDING) / (DURATION - LANDING))
              );
      const [left, right, top, height] = edges;
      const shape = { x: left, y: top, width: right - left, height };
      // Moving clip edges preserves circular caps throughout the stretch.
      frames.push({ clipPath: this.#clip(shape), offset: time / DURATION });
      fills.push({
        clipPath: this.#clip(shape, inset),
        offset: time / DURATION,
      });
    }
    const timing = { duration: DURATION, easing: "linear" };
    this.#animation = this.#indicator.animate(frames, timing);
    this.#fillAnimation = this.#fill.animate(fills, timing);
  }
}
