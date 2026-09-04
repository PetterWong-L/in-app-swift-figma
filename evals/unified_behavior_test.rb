# frozen_string_literal: true

require "minitest/autorun"
require "tmpdir"
require "yaml"

require_relative "../scripts/task_config_core"

class UnifiedBehaviorTest < Minitest::Test
  def test_schema_v3_accepts_state_change_and_ordered_effect_actions
    config = schema_v3_config

    Dir.mktmpdir do |dir|
      path = File.join(dir, "InAppFigma.yaml")
      File.write(path, YAML.dump(config))
      snapshot = TaskConfig.new(path).snapshot

      assert_equal 7, snapshot.dig("schema", "version")
      page = snapshot.dig("config", "modules", 0, "pages", 0)
      refute page.key?("state_transitions")
      refute page.key?("navigation")
      behavior = page.fetch("behaviors").first
      assert_equal "submitting", behavior.fetch("state_change")
      assert_equal %w[start_countdown present_popup], behavior.fetch("actions").map { |action| action.fetch("type") }
      assert_equal "popup", snapshot.dig("config", "modules", 0, "pages", 1, "page_role")
    end
  end

  def test_schema_v3_accepts_state_only_and_actions_only_interactions
    state_only = schema_v3_config
    state_only.dig("modules", 0, "pages", 0, "behaviors")[0].delete("actions")
    actions_only = schema_v3_config
    actions_only.dig("modules", 0, "pages", 0, "behaviors")[0].delete("state_change")

    [state_only, actions_only].each do |config|
      TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
    end
  end

  def test_timer_actions_accept_countdown_without_parameters_and_countup_targets
    config = schema_v3_config
    page = config.dig("modules", 0, "pages", 0)
    page["behaviors"] = [
      interaction("start-countdown", "countdown", { "event" => "tap" }, [
        { "type" => "start_countdown", "target" => "countdown" }
      ]),
      interaction("start-countup", "elapsed", { "event" => "tap" }, [
        { "type" => "start_countup", "target" => "elapsed" }
      ]),
      interaction("stop-countup", "elapsed", { "event" => "tap" }, [
        { "type" => "stop_countup", "target" => "elapsed" }
      ])
    ]

    TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
  end

  def test_conditional_navigation_accepts_two_complete_destination_branches
    config = schema_v3_config
    page = config.dig("modules", 0, "pages", 0)
    page["behaviors"] = [interaction("continue", "continue-button", { "event" => "tap" }, [{
      "type" => "navigate",
      "branches" => [
        {
          "condition" => "session.is_member",
          "style" => "push",
          "destination" => "account.home",
          "destination_instance" => "new",
          "parameters" => { "userID" => "session.user_id" }
        },
        {
          "condition" => "!session.is_member",
          "style" => "sheet",
          "destination" => "account.home",
          "destination_instance" => "new",
          "parameters" => {}
        }
      ]
    }])]

    TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
  end

  def test_conditional_navigation_rejects_missing_conditions_and_mixed_single_route_fields
    config = schema_v3_config
    page = config.dig("modules", 0, "pages", 0)
    page["behaviors"] = [interaction("continue", "continue-button", { "event" => "tap" }, [{
      "type" => "navigate",
      "style" => "push",
      "destination" => "account.home",
      "branches" => [
        { "condition" => "", "style" => "push", "destination" => "account.home" },
        { "condition" => "session.is_guest", "style" => "push", "destination" => "account.home" }
      ]
    }])]

    error = assert_raises(TaskConfigError) do
      TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
    end
    assert_includes error.message, "navigate with branches must not define style"
    assert_includes error.message, "branches[0].condition must be a non-empty string"
  end

  def test_popup_only_module_accepts_a_null_entry_page
    config = schema_v3_config
    popup = config.dig("modules", 0, "pages", 1)
    config["modules"] = [{
      "id" => "common",
      "title" => "Common",
      "entry_page" => nil,
      "pages" => [popup]
    }]

    TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
  end

  def test_popup_only_module_rejects_a_popup_as_its_entry_page
    config = schema_v3_config
    popup = config.dig("modules", 0, "pages", 1)
    config["modules"] = [{
      "id" => "common",
      "title" => "Common",
      "entry_page" => "confirmation-popup",
      "pages" => [popup]
    }]

    error = assert_raises(TaskConfigError) do
      TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
    end
    assert_includes error.message, "entry_page must be null when the module has no screen pages"
  end

  def test_schema_v3_completion_sources_can_find_effects_anywhere_in_actions
    config = schema_v3_config
    page = config.dig("modules", 0, "pages", 0)
    page["behaviors"] = [
      interaction("start-timer", "timer", { "event" => "page_appear" }, [
        { "type" => "emit_event", "name" => "timer_started" },
        { "type" => "start_countdown", "target" => "timer", "parameters" => { "duration_seconds" => "30" } }
      ]),
      interaction("start-video", "video", { "event" => "tap" }, [
        { "type" => "custom", "name" => "prepare_video" },
        { "type" => "play_video", "target" => "video" }
      ]),
      interaction("timer-finished", "timer", { "event" => "timer_finished", "source" => "start-timer" }, [], state_change: "submitting"),
      interaction("video-finished", "video", { "event" => "video_finished", "source" => "start-video" }, [], state_change: "submitting")
    ]

    TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
  end

  def test_schema_v3_rejects_invalid_effect_contracts_and_popup_roles
    cases = {
      "must define state_change or at least one action" => lambda do |config|
        behavior = config.dig("modules", 0, "pages", 0, "behaviors", 0)
        behavior.delete("state_change")
        behavior.delete("actions")
      end,
      "state_change must reference a state in this page" => lambda do |config|
        config.dig("modules", 0, "pages", 0, "behaviors", 0)["state_change"] = "missing"
      end,
      "actions must be an array" => lambda do |config|
        config.dig("modules", 0, "pages", 0, "behaviors", 0)["actions"] = "start_countdown"
      end,
      "actions[0].type must be one of" => lambda do |config|
        config.dig("modules", 0, "pages", 0, "behaviors", 0)["actions"] = [{ "type" => "set_state" }]
      end,
      "must contain at most one presentation action" => lambda do |config|
        config.dig("modules", 0, "pages", 0, "behaviors", 0)["actions"] << {
          "type" => "dismiss_popup"
        }
      end,
      "presentation actions must be last" => lambda do |config|
        actions = config.dig("modules", 0, "pages", 0, "behaviors", 0, "actions")
        actions << actions.shift
      end,
      "destination must reference a popup page" => lambda do |config|
        config.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 1)["destination"] = "account.home"
      end,
      "destination must reference a screen page" => lambda do |config|
        config.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 1).replace(
          "type" => "navigate", "style" => "push", "destination" => "account.confirmation-popup"
        )
      end,
      "entry_page must reference a screen page" => lambda do |config|
        config.dig("modules", 0)["entry_page"] = "confirmation-popup"
      end,
      "page_role must be one of screen, popup" => lambda do |config|
        config.dig("modules", 0, "pages", 0).delete("page_role")
      end
    }

    cases.each do |expected, mutate|
      config = schema_v3_config
      mutate.call(config)
      error = assert_raises(TaskConfigError) { TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate! }
      assert_includes error.message, expected
    end
  end

  def test_schema_v3_rejects_legacy_transition_sections_and_singular_action
    config = schema_v3_config
    page = config.dig("modules", 0, "pages", 0)
    page["state_transitions"] = []
    page["navigation"] = { "transitions" => [] }
    page.fetch("behaviors").first["action"] = { "type" => "set_state", "state_id" => "submitting" }

    error = assert_raises(TaskConfigError) { TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate! }

    assert_includes error.message, "state_transitions is not supported in schema v7"
    assert_includes error.message, "navigation is not supported in schema v7"
    assert_includes error.message, "action is not supported in schema v7"
  end

  def test_schema_v1_transitions_migrate_to_unified_behaviors
    config = schema_v3_config
    config["schema_version"] = 1
    page = config.dig("modules", 0, "pages", 0)
    page["behaviors"] = []
    page["state_transitions"] = [{
      "id" => "show-dialog",
      "from" => "editing",
      "to" => "submitting",
      "action" => "tap_help"
    }]
    page["navigation"] = {
      "transitions" => [{
        "id" => "open-details",
        "action" => "tap_details",
        "style" => "push",
        "destination" => "account.home",
        "destination_instance" => "new"
      }]
    }

    Dir.mktmpdir do |dir|
      path = File.join(dir, "InAppFigma.yaml")
      File.write(path, YAML.dump(config))
      migrated = TaskConfig.new(path).data
      behaviors = migrated.dig("modules", 0, "pages", 0, "behaviors")

      assert_equal 7, migrated.fetch("schema_version")
      assert_equal({ "event" => "tap" }, behaviors[0].fetch("trigger"))
      assert_equal "help", behaviors[0].fetch("target")
      assert_equal "submitting", behaviors[0].fetch("state_change")
      assert_equal "account.home", behaviors[1].dig("actions", 0, "destination")
      migrated.dig("modules", 0, "pages").each { |item| assert_equal "screen", item.fetch("page_role") }
      refute migrated.dig("modules", 0, "pages", 0).key?("navigation")
    end
  end

  private

  def schema_v3_config
    {
      "schema_version" => 3,
      "execution" => { "parallel" => false, "max_parallel" => 3 },
      "mock_data_sources" => [],
      "modules" => [{
        "id" => "account",
        "title" => "Account",
        "entry_page" => "home",
        "pages" => [
          page_defaults.merge(
            "id" => "home",
            "title" => "Home",
            "page_role" => "screen",
            "states" => states,
            "behaviors" => [combined_behavior]
          ),
          page_defaults.merge(
            "id" => "confirmation-popup",
            "title" => "Confirmation Popup",
            "page_role" => "popup",
            "states" => [states.first.dup],
            "behaviors" => []
          )
        ]
      }]
    }
  end

  def page_defaults
    {
      "page_type" => "view",
      "status" => "todo",
      "attempts" => 0,
      "commit" => nil,
      "reason" => nil,
      "started_at" => nil,
      "completed_at" => nil,
      "acceptance_history" => [],
      "data_dependencies" => []
    }
  end

  def states
    [
      { "id" => "editing", "title" => "Editing", "figma_url" => "https://www.figma.com/design/FILE/Home?node-id=1-1" },
      { "id" => "submitting", "title" => "Submitting", "figma_url" => "https://www.figma.com/design/FILE/Home?node-id=1-2" }
    ]
  end

  def combined_behavior
    {
      "id" => "submit-order",
      "type" => "interaction",
      "target" => "submit-button",
      "states" => ["editing"],
      "trigger" => { "event" => "tap" },
      "state_change" => "submitting",
      "actions" => [
        {
          "type" => "start_countdown",
          "target" => "timeout-label",
          "parameters" => { "duration_seconds" => "30" }
        },
        {
          "type" => "present_popup",
          "destination" => "account.confirmation-popup",
          "parameters" => { "title" => "confirmation_title", "primary_text" => "confirm_text" }
        }
      ],
      "run_policy" => "every_time"
    }
  end

  def interaction(id, target, trigger, actions, state_change: nil)
    behavior = {
      "id" => id,
      "type" => "interaction",
      "target" => target,
      "trigger" => trigger,
      "actions" => actions,
      "run_policy" => "every_time"
    }
    behavior["state_change"] = state_change if state_change
    behavior
  end
end
