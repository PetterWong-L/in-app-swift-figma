# frozen_string_literal: true

require "minitest/autorun"

require_relative "../scripts/task_config_core"

class PopupResultTest < Minitest::Test
  def test_accepts_popup_structure_with_independent_fields_and_ordered_buttons
    config = popup_template_config

    loaded = TaskConfig.send(:from_data, config, path: "InAppFigma.yaml")

    assert_equal 6, loaded.data.fetch("schema_version")
    assert_equal(
      {
        "implementation_status" => "todo",
        "fields" => { "title" => true, "subtitle" => false, "content" => true },
        "buttons" => [{ "id" => "cancel" }, { "id" => "confirm" }]
      },
      loaded.data.dig("modules", 0, "pages", 0, "popup")
    )
  end

  def test_rejects_popup_structure_role_field_and_button_contract_violations
    screen_config = popup_template_config
    screen = screen_config.dig("modules", 0, "pages", 0)
    screen["page_role"] = "screen"
    screen_config.dig("modules", 0)["entry_page"] = screen.fetch("id")
    error = assert_raises(TaskConfigError) do
      TaskConfig.send(:from_data, screen_config, path: "InAppFigma.yaml").validate!
    end
    assert_includes error.message, "pages[0].popup is allowed only when page_role is popup"

    missing_config = popup_template_config
    missing_config.dig("modules", 0, "pages", 0).delete("popup")
    assert_validation_error(missing_config, "pages[0].popup is required when page_role is popup")

    invalid_config = popup_template_config
    popup = invalid_config.dig("modules", 0, "pages", 0, "popup")
    popup["fields"]["title"] = "yes"
    popup["buttons"] = [{ "id" => "confirm" }, { "id" => "confirm" }, { "id" => "Bad ID" }]
    error = assert_raises(TaskConfigError) do
      TaskConfig.send(:from_data, invalid_config, path: "InAppFigma.yaml").validate!
    end
    assert_includes error.message, ".popup.fields.title must be true or false"
    assert_includes error.message, "duplicate popup button id confirm"
    assert_includes error.message, ".popup.buttons[2].id must use lowercase letters, digits, and hyphens"
  end

  def test_popup_structure_is_an_amendable_singleton_task
    config = popup_template_config
    popup_page = config.dig("modules", 0, "pages", 0)
    popup_page["status"] = "done"
    popup_page["popup"]["implementation_status"] = "done"
    popup_page["states"].each { |state| state["implementation_status"] = "done" }
    popup_page["accepted_baseline"] = {
      "states" => popup_page.fetch("states").map { |item| item.reject { |key, _| key == "implementation_status" } },
      "behaviors" => [],
      "popup" => Marshal.load(Marshal.dump(
        popup_page.fetch("popup").reject { |key, _| key == "implementation_status" }
      ))
    }
    popup_page["popup"]["fields"]["subtitle"] = true
    popup_page["popup"]["implementation_status"] = "todo"

    changes = TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").page_changes("common", "confirmation-popup")

    assert_equal [{
      "kind" => "popup",
      "id" => "structure",
      "implementation_status" => "todo",
      "change" => "modified",
      "changed_fields" => ["fields.subtitle"]
    }], changes.fetch("popup")
  end

  def test_accepts_typed_popup_presentation_with_caller_owned_callbacks
    loaded = TaskConfig.send(:from_data, popup_presentation_config, path: "InAppFigma.yaml")

    loaded.validate!

    refute_includes TaskConfig.schema_metadata.fetch("behavior_trigger_events"), "popup_result"
    refute_includes TaskConfig.schema_metadata.fetch("behavior_action_types"), "return_popup_result"
  end

  def test_rejects_missing_extra_and_disabled_popup_content_bindings
    missing = popup_presentation_config
    presentation_action(missing).fetch("content").delete("title")
    assert_validation_error(missing, ".content.title is required by the popup template")

    extra = popup_presentation_config
    presentation_action(extra).fetch("content")["subtitle"] = "delete_subtitle"
    assert_validation_error(extra, ".content.subtitle is not enabled by the popup template")

    blank = popup_presentation_config
    presentation_action(blank).fetch("content")["content"] = "  "
    assert_validation_error(blank, ".content.content must be a non-empty string")
  end

  def test_rejects_popup_button_binding_and_callback_contract_violations
    misordered = popup_presentation_config
    presentation_action(misordered).fetch("buttons").reverse!
    assert_validation_error(misordered, ".buttons must match popup template button order: cancel, confirm")

    empty_text = popup_presentation_config
    presentation_action(empty_text).dig("buttons", 0)["text"] = ""
    assert_validation_error(empty_text, ".buttons[0].text must be a non-empty string")

    empty_callback = popup_presentation_config
    presentation_action(empty_callback).dig("buttons", 0)["callback"] = { "actions" => [] }
    assert_validation_error(empty_callback, ".buttons[0].callback must define state_change or at least one action")

    wrong_state = popup_presentation_config
    presentation_action(wrong_state).dig("buttons", 1, "callback")["state_change"] = "popup-only"
    assert_validation_error(wrong_state, ".buttons[1].callback.state_change must reference a state in the calling page")
  end

  def test_rejects_legacy_popup_authoring_and_misordered_callback_presentations
    legacy_trigger = popup_presentation_config
    legacy_trigger.dig("modules", 0, "pages", 0, "behaviors", 0, "trigger")["event"] = "popup_result"
    assert_validation_error(legacy_trigger, ".trigger.event must be one of")

    legacy_action = popup_presentation_config
    presentation_action(legacy_action).dig("buttons", 0, "callback", "actions")[0] = {
      "type" => "return_popup_result", "result" => "cancel"
    }
    assert_validation_error(legacy_action, ".type must be one of")

    legacy_parameters = popup_presentation_config
    presentation_action(legacy_parameters)["parameters"] = { "title" => "old_title" }
    assert_validation_error(legacy_parameters, ".present_popup must not define parameters")

    misordered = popup_presentation_config
    presentation_action(misordered).dig("buttons", 1, "callback", "actions") << {
      "type" => "emit_event", "name" => "finished"
    }
    assert_validation_error(misordered, ".callback.actions[0] presentation actions must be last")
  end

  def test_schema_v5_popup_result_flow_migrates_to_typed_button_callbacks
    config = popup_result_config
    presentation = config.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 0)
    presentation["parameters"] = {
      "title" => "delete_title",
      "content" => "delete_message",
      "confirmed_text" => "confirm_text"
    }
    config.dig("modules", 0, "pages", 2, "behaviors", 0, "actions", 0).delete("parameters")

    loaded = TaskConfig.send(:from_data, config, path: "InAppFigma.yaml")
    loaded.validate!
    migrated = loaded.data

    assert_equal 6, migrated.fetch("schema_version")
    assert_equal({ "title" => true, "subtitle" => false, "content" => true },
                 migrated.dig("modules", 0, "pages", 2, "popup", "fields"))
    assert_equal ["confirmed"], migrated.dig("modules", 0, "pages", 2, "popup", "buttons").map { |item| item.fetch("id") }
    migrated_presentation = migrated.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 0)
    assert_equal({ "title" => "delete_title", "content" => "delete_message" }, migrated_presentation.fetch("content"))
    assert_equal "confirm_text", migrated_presentation.dig("buttons", 0, "text")
    assert_equal "common.result", migrated_presentation.dig("buttons", 0, "callback", "actions", 0, "destination")
    assert_equal 1, migrated.dig("modules", 0, "pages", 0, "behaviors").length
    assert_empty migrated.dig("modules", 0, "pages", 2, "behaviors")
    refute migrated.key?("migration_compatibility")
  end

  def test_schema_v4_migrates_through_v5_to_v6
    config = popup_result_config
    config["schema_version"] = 4
    config.dig("modules", 0, "pages", 0, "behaviors").pop
    popup = config.dig("modules", 0, "pages", 2)
    popup["behaviors"] = [interaction("dismiss", "close_button", { "event" => "tap" }, [
      { "type" => "dismiss_popup" }
    ])]
    migrated = TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").data

    assert_equal 6, migrated.fetch("schema_version")
    assert migrated.dig("modules", 0, "pages", 2, "popup")
  end

  def test_ambiguous_v5_popup_data_is_preserved_and_blocks_strict_validation
    config = popup_result_config
    presentation_action = config.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 0)
    presentation_action["parameters"] = { "title" => "delete_title", "unknown" => "keep_me" }
    popup = config.dig("modules", 0, "pages", 2)
    popup.fetch("behaviors") << interaction("confirm-alt", "secondary_button", { "event" => "tap" }, [
      { "type" => "return_popup_result", "result" => "confirmed" }
    ])

    loaded = TaskConfig.send(:from_data, config, path: "InAppFigma.yaml")
    compatibility = loaded.data.fetch("migration_compatibility")

    assert compatibility.any? { |item| item.fetch("reason").include?("multiple popup targets") }
    assert compatibility.any? { |item| item.fetch("reason").include?("Unknown legacy presentation parameters") }
    assert compatibility.any? { |item| item.fetch("legacy").to_s.include?("keep_me") }
    error = assert_raises(TaskConfigError) { loaded.validate! }
    assert_includes error.message, "migration_compatibility"
  end

  def test_v5_migration_is_idempotent_after_the_first_conversion
    config = popup_result_config
    presentation = config.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 0)
    presentation["parameters"] = { "confirmed_text" => "confirm_text" }
    config.dig("modules", 0, "pages", 2, "behaviors", 0, "actions", 0).delete("parameters")

    once = TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").data
    twice = TaskConfig.send(:from_data, once, path: "InAppFigma.yaml").data

    assert_equal once, twice
  end

  private

  def popup_template_config
    {
      "schema_version" => 6,
      "delivery" => { "profile" => "strict" },
      "system_ui" => { "tab_bar_controller" => false, "picker" => false },
      "execution" => { "parallel" => false, "max_parallel" => 3 },
      "mock_data_sources" => [],
      "modules" => [{
        "id" => "common",
        "title" => "Common",
        "entry_page" => nil,
        "pages" => [page("confirmation-popup", "Confirmation Popup", "popup", []).merge(
          "popup" => {
            "implementation_status" => "todo",
            "fields" => { "title" => true, "subtitle" => false, "content" => true },
            "buttons" => [{ "id" => "cancel" }, { "id" => "confirm" }]
          }
        )]
      }]
    }
  end

  def popup_presentation_config
    config = popup_template_config
    mod = config.dig("modules", 0)
    popup = mod.fetch("pages").first
    popup.fetch("states") << {
      "id" => "popup-only",
      "implementation_status" => "todo",
      "title" => "Popup only",
      "figma_url" => "https://www.figma.com/design/FILE/confirmation-popup?node-id=2-2"
    }
    home = page("home", "Home", "screen", [
      interaction("request-delete", "delete_button", { "event" => "tap" }, [
        {
          "type" => "present_popup",
          "destination" => "common.confirmation-popup",
          "content" => { "title" => "delete_title", "content" => "delete_message" },
          "buttons" => [
            {
              "id" => "cancel",
              "text" => "cancel_text",
              "callback" => { "actions" => [{ "type" => "dismiss_popup" }] }
            },
            {
              "id" => "confirm",
              "text" => "confirm_text",
              "callback" => {
                "state_change" => "deleting",
                "actions" => [{
                  "type" => "navigate",
                  "style" => "push",
                  "destination" => "common.result"
                }]
              }
            }
          ]
        }
      ])
    ])
    home.fetch("states") << {
      "id" => "deleting",
      "implementation_status" => "todo",
      "title" => "Deleting",
      "figma_url" => "https://www.figma.com/design/FILE/home?node-id=2-2"
    }
    mod["entry_page"] = "home"
    mod["pages"] = [home, page("result", "Result", "screen", []), popup]
    config
  end

  def presentation_action(config)
    config.dig("modules", 0, "pages", 0, "behaviors", 0, "actions", 0)
  end

  def popup_result_config
    {
      "schema_version" => 5,
      "delivery" => { "profile" => "strict" },
      "system_ui" => { "tab_bar_controller" => false, "picker" => false },
      "execution" => { "parallel" => false, "max_parallel" => 3 },
      "mock_data_sources" => [],
      "modules" => [{
        "id" => "common",
        "title" => "Common",
        "entry_page" => "home",
        "pages" => [
          page("home", "Home", "screen", [
            interaction("open-confirmation", "delete_button", { "event" => "tap" }, [
              { "type" => "present_popup", "destination" => "common.confirmation-popup" }
            ]),
            interaction(
              "handle-confirmation",
              "confirmation_result",
              { "event" => "popup_result", "source" => "open-confirmation", "result" => "confirmed" },
              [{ "type" => "navigate", "style" => "push", "destination" => "common.result" }]
            )
          ]),
          page("result", "Result", "screen", []),
          page("confirmation-popup", "Confirmation Popup", "popup", [
            interaction("confirm", "primary_button", { "event" => "tap" }, [
              {
                "type" => "return_popup_result",
                "result" => "confirmed",
                "parameters" => { "itemID" => "selected_item_id" }
              }
            ])
          ])
        ]
      }]
    }
  end

  def page(id, title, role, behaviors)
    {
      "id" => id,
      "title" => title,
      "page_type" => "view",
      "page_role" => role,
      "status" => "todo",
      "attempts" => 0,
      "commit" => nil,
      "reason" => nil,
      "started_at" => nil,
      "completed_at" => nil,
      "acceptance_history" => [],
      "accepted_baseline" => nil,
      "removed_tasks" => [],
      "data_dependencies" => [],
      "states" => [{
        "id" => "default",
        "implementation_status" => "todo",
        "title" => "Default",
        "figma_url" => "https://www.figma.com/design/FILE/#{id}?node-id=1-1"
      }],
      "behaviors" => behaviors
    }
  end

  def interaction(id, target, trigger, actions)
    {
      "id" => id,
      "implementation_status" => "todo",
      "type" => "interaction",
      "target" => target,
      "trigger" => trigger,
      "actions" => actions,
      "run_policy" => "every_time"
    }
  end

  def assert_validation_error(config, expected)
    error = assert_raises(TaskConfigError) do
      TaskConfig.send(:from_data, config, path: "InAppFigma.yaml").validate!
    end
    assert_includes error.message, expected
  end
end
