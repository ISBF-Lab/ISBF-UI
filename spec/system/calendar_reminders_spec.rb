# frozen_string_literal: true

RSpec.describe "Calendar reminders" do
  let!(:theme) { upload_theme }
  fab!(:user) { Fabricate(:user, trust_level: 3, approved: true) }

  before do
    SiteSetting.isbf_calendar_reminders_enabled = true
    SiteSetting.isbf_calendar_reminder_delivery_mode = "in_app"
    sign_in(user)
  end

  [390, 430, 600, 601, 1024, 1440].each do |width|
    %w[light dark].each do |mode|
      context "at #{width}px in #{mode}", mobile: width <= 600 do
        before do
          scheme = theme.color_schemes.find_by!(name: "ISBF Community #{mode.capitalize}")
          theme.update!(color_scheme_id: scheme.id)
          user.user_option.update!(color_scheme_id: scheme.id, dark_scheme_id: scheme.id)
          page.current_window.resize_to(width, 900)
        end

        it "contains the real editor and preserves input through reminder selection" do
          visit "/isbf/calendar"
          find(".isbf-v2-calendar__heading .isbf-v2-calendar__primary").click
          expect(page).to have_css(".isbf-calendar-entry-editor")
          within ".isbf-calendar-entry-editor" do
            find('[data-name="title"] input').set("Synthetic unsaved reminder")
            find(".isbf-calendar-reminder__row").click
            expect(page).to have_css('input[value="before_15m"]')
            find('input[value="before_15m"]').click
            find(".isbf-calendar-reminder__actions .btn-primary").click
            expect(page).to have_field(with: "Synthetic unsaved reminder")
          end
          geometry = page.evaluate_script(<<~JS)
            (() => {
              const el = document.querySelector('.isbf-calendar-entry-editor .d-modal__container');
              const rect = el.getBoundingClientRect();
              return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
                radius: getComputedStyle(el).borderTopLeftRadius,
                viewportWidth: innerWidth, viewportHeight: innerHeight,
                overflow: document.documentElement.scrollWidth > innerWidth + 1 };
            })()
          JS
          expect(geometry["overflow"]).to eq(false)
          if width <= 600
            expect(geometry["left"].abs).to be < 2
            expect(geometry["top"].abs).to be < 2
            expect((geometry["width"] - geometry["viewportWidth"]).abs).to be < 2
            expect((geometry["height"] - geometry["viewportHeight"]).abs).to be < 2
            expect(geometry["radius"]).to eq("0px")
          else
            expect(geometry["width"]).to be <= 561
            expect(geometry["left"]).to be_within(2).of((geometry["viewportWidth"] - geometry["width"]) / 2)
          end
          folder = Rails.root.join("tmp/isbf-reminder-results/screenshots")
          FileUtils.mkdir_p(folder)
          page.save_screenshot(folder.join("editor-#{width}-#{mode}.png"))
          if width <= 600
            page.execute_script("document.documentElement.style.setProperty('--composer-vh', '5px'); document.documentElement.classList.add('keyboard-visible');")
            expect(page).to have_css(".isbf-calendar-entry-editor__header")
            expect(page.evaluate_script("document.querySelector('.isbf-calendar-entry-editor .d-modal__container').getBoundingClientRect().height")).to be_within(2).of(500)
            page.execute_script("document.querySelector('.isbf-calendar-entry-editor .d-modal__body').scrollTop = 10000;")
            expect(page.evaluate_script("document.querySelector('.isbf-calendar-entry-editor__header').getBoundingClientRect().top")).to be_within(2).of(0)
            page.execute_script("document.documentElement.style.removeProperty('--composer-vh'); document.documentElement.classList.remove('keyboard-visible');")
          end
          find(".isbf-calendar-entry-editor__cancel").click
          expect(page).to have_no_css(".isbf-calendar-entry-editor")
          expect(IsbfCalendar::Entry.where(user: user)).to be_empty
        end
      end
    end
  end

  it "saves through the real API and opens its native reminder notification" do
    page.current_window.resize_to(1440, 900)
    visit "/isbf/calendar"
    find(".isbf-v2-calendar__heading .isbf-v2-calendar__primary").click
    within ".isbf-calendar-entry-editor" do
      find('[data-name="title"] input').set("Synthetic reminder plan")
      day = 2.days.from_now.strftime("%Y-%m-%d")
      find('[data-name="startDate"] input').set(day)
      find('[data-name="endDate"] input').set(day)
      find(".isbf-calendar-reminder__row").click
      find('input[value="before_15m"]').click
      find(".isbf-calendar-reminder__actions .btn-primary").click
      find(".isbf-calendar-entry-editor__save").click
    end
    expect(page).to have_no_css(".isbf-calendar-entry-editor")
    entry = IsbfCalendar::Entry.find_by!(user: user, title: "Synthetic reminder plan")
    expect(entry.reminder_mode).to eq("before_15m")
    expect(entry.reminder_processed_at).to be_nil
    expect(entry.reminder_at).to be > Time.current
    freeze_time(entry.reminder_at + 1.second) { Jobs::IsbfCalendarSendReminders.new.execute({}) }
    expect(Notification.where(user: user, notification_type: Notification.types[:custom]).count).to eq(1)
    visit "/u/#{user.username_lower}/notifications"
    expect(page).to have_content("Synthetic reminder plan")
    find('a[href*="/isbf/calendar?entry_id="]').click
    expect(page).to have_current_path("/isbf/calendar?entry_id=#{entry.id}")
    expect(page).to have_css(".isbf-v2-calendar__item", text: "Synthetic reminder plan")
  end
end
