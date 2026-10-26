# frozen_string_literal: true

RSpec.describe "Alumni identity labels" do
  let!(:theme) { upload_theme }
  fab!(:alumni_group) { Fabricate(:group, name: "alumni") }
  fab!(:member) { Fabricate(:user, username: "alumnilabel_member", active: true, approved: true) }
  fab!(:ordinary) { Fabricate(:user, username: "alumnilabel_ordinary", active: true, approved: true) }
  fab!(:applicant) { Fabricate(:user, username: "alumnilabel_pending", active: true, approved: true) }
  fab!(:member_topic) { Fabricate(:topic, user: member) }
  fab!(:ordinary_topic) { Fabricate(:topic, user: ordinary) }
  fab!(:pending_topic) { Fabricate(:topic, user: applicant) }
  fab!(:member_post) { Fabricate(:post, topic: member_topic, user: member) }
  fab!(:ordinary_post) { Fabricate(:post, topic: ordinary_topic, user: ordinary) }
  fab!(:pending_post) { Fabricate(:post, topic: pending_topic, user: applicant) }

  before do
    SiteSetting.login_required = false
    SiteSetting.default_locale = "zh_CN"
    SiteSetting.isbf_alumni_enabled = true
    SiteSetting.isbf_alumni_group_name = alumni_group.name
    alumni_group.add(member)
    member.upsert_custom_fields(IsbfAlumni::VISIBLE_FIELD => "false")
    IsbfAlumni::Application.create!(email: applicant.email, user: applicant, status: "pending")
  end

  def expect_feed_identities
    member_name = ".isbf-feed-card__username[href='/u/#{member.username}']"
    ordinary_name = ".isbf-feed-card__username[href='/u/#{ordinary.username}']"
    pending_name = ".isbf-feed-card__username[href='/u/#{applicant.username}']"
    expect(page).to have_css("#{member_name} .isbf-alumni-label", text: "校友", count: 1)
    expect(page).to have_css(ordinary_name)
    expect(page).to have_css(pending_name)
    expect(page).to have_no_css("#{ordinary_name} .isbf-alumni-label")
    expect(page).to have_no_css("#{pending_name} .isbf-alumni-label")
    expect(page).to have_no_css(".isbf-feed-card__avatar .isbf-alumni-label", visible: :all)
  end

  [390, 430, 600, 601, 1024, 1440].each do |width|
    %w[light dark].each do |mode|
      context "at #{width}px in #{mode}", mobile: width <= 600 do
        before do
          scheme = theme.color_schemes.find_by!(name: "ISBF Community #{mode.capitalize}")
          theme.update!(color_scheme_id: scheme.id)
          member.user_option.update!(color_scheme_id: scheme.id, dark_scheme_id: scheme.id)
          page.current_window.resize_to(width, 900)
          sign_in(member)
        end

        it "labels only real members beside account names across feed, profile, search, and topic" do
          visit "/latest"
          expect_feed_identities
          if width == 1440
            expect(page).to have_css(".isbf-v2-side__account small .isbf-alumni-label", text: "校友")
          end

          visit "/u/#{member.username}"
          expect(page).to have_css(".user-profile-names .username .isbf-alumni-label", text: "校友", count: 1)
          expect(page).to have_no_css(".user-profile-avatar .isbf-alumni-label", visible: :all)

          visit "/search?q=alumnilabel&search_type=users"
          member_result = ".fps-user-item[data-user-card='#{member.username}'] .username"
          ordinary_result = ".fps-user-item[data-user-card='#{ordinary.username}'] .username"
          pending_result = ".fps-user-item[data-user-card='#{applicant.username}'] .username"
          expect(page).to have_css("#{member_result} .isbf-alumni-label", text: "校友", count: 1)
          expect(page).to have_css(ordinary_result)
          expect(page).to have_css(pending_result)
          expect(page).to have_no_css("#{ordinary_result} .isbf-alumni-label")
          expect(page).to have_no_css("#{pending_result} .isbf-alumni-label")

          visit member_topic.url
          expect(page).to have_css("#post_1 .isbf-feed-card__username .isbf-alumni-label", text: "校友", count: 1)
          expect(page).to have_no_css("#post_1 .topic-avatar .isbf-alumni-label", visible: :all)

          folder = Rails.root.join("tmp/isbf-alumni-identity-results/screenshots")
          FileUtils.mkdir_p(folder)
          page.save_screenshot(folder.join("topic-#{width}-#{mode}.png"))
        end
      end
    end
  end

  it "keeps the label beside the username when the same profile gains a full name" do
    SiteSetting.enable_names = true
    SiteSetting.prioritize_username_in_ux = false
    member.update!(name: "")
    sign_in(ordinary)
    visit "/u/#{member.username}"
    expect(page).to have_css(".user-profile-names .username .isbf-alumni-label", text: "校友")
    page.execute_script <<~JS
      const owner = require("discourse/lib/get-owner").getOwnerWithFallback();
      owner.lookup("controller:user").model.set("name", "Alumni display name");
    JS
    expect(page).to have_css(".user-profile-names .full-name", text: "Alumni display name")
    expect(page).to have_css(".user-profile-names .username .isbf-alumni-label", text: "校友", count: 1)
    expect(page).to have_no_css(".user-profile-names .full-name .isbf-alumni-label")
  end

  it "shows identity in the native card after clicking the topic account" do
    sign_in(ordinary)
    visit member_topic.url
    find("#post_1 .isbf-feed-card__username").click
    expect(page).to have_css("#user-card .username .isbf-alumni-label", text: "校友", count: 1)
    expect(page).to have_no_css("#user-card .avatar .isbf-alumni-label", visible: :all)
  end
  it "shows the same member and nonmember distinction to guests" do
    page.current_window.resize_to(1440, 900)
    visit "/latest"
    expect_feed_identities
  end

  it "shows membership to an ordinary viewer without labeling that viewer's own profile" do
    page.current_window.resize_to(1440, 900)
    sign_in(ordinary)
    visit "/latest"
    expect_feed_identities
    expect(page).to have_css(".isbf-v2-side__account small", text: ordinary.username)
    expect(page).to have_no_css(".isbf-v2-side__account small .isbf-alumni-label")
    visit "/u/#{ordinary.username}"
    expect(page).to have_css(".user-profile-names .username", text: ordinary.username)
    expect(page).to have_no_css(".user-profile-names .username .isbf-alumni-label")
  end

  it "removes the label after native group membership is removed and the page is freshly loaded" do
    page.current_window.resize_to(1440, 900)
    sign_in(ordinary)
    visit "/latest"
    expect_feed_identities
    alumni_group.remove(member)
    page.refresh
    member_name = ".isbf-feed-card__username[href='/u/#{member.username}']"
    expect(page).to have_css(member_name)
    expect(page).to have_no_css("#{member_name} .isbf-alumni-label")
  end
end
