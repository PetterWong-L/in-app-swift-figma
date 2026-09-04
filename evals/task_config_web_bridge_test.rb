# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "tmpdir"
require "yaml"

class TaskConfigWebBridgeTest < Minitest::Test
  BRIDGE = File.expand_path("../scripts/task_config_web_bridge.rb", __dir__)

  def setup
    @dir = Dir.mktmpdir
    @path = File.join(@dir, "InAppFigma.yaml")
    File.write(@path, "# Header\n#{YAML.dump(valid_config)}")
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def test_snapshot_returns_revision_and_preview
    payload, err, status = run_bridge("snapshot", {})

    assert status.success?, err
    assert_equal "", err
    assert_equal true, payload.fetch("ok")
    assert_equal 200, payload.fetch("status")
    assert_match(/\A[0-9a-f]{64}\z/, payload.dig("snapshot", "revision"))
    assert_includes payload.dig("snapshot", "yaml_preview"), "schema_version: 6"
    assert_equal 6, payload.dig("snapshot", "schema", "version")
  end

  def test_validate_returns_422_with_structured_issues
    draft = valid_config
    draft["modules"][0]["pages"][0]["navigation"]["transitions"][0]["destination"] = "account.missing"

    payload, err, status = run_bridge("validate", { "config" => draft })

    assert status.success?, err
    assert_equal 422, payload.fetch("status")
    assert_equal "unknown_destination", payload.dig("issues", 0, "code")
  end

  def test_save_returns_409_for_stale_revision_without_stderr
    payload, err, status = run_bridge("save", {
      "config" => valid_config,
      "expected_revision" => "0" * 64
    })

    assert status.success?, err
    assert_equal "", err
    assert_equal 409, payload.fetch("status")
    assert_equal "revision_conflict", payload.dig("error", "code")
  end

  def test_snapshot_migrates_schema_v2_fixture_to_v6
    File.write(@path, "# Header\n#{YAML.dump(valid_v2_config)}")

    payload, err, status = run_bridge("snapshot", {})

    assert status.success?, err
    assert_equal 6, payload.dig("snapshot", "schema", "version")
    page = payload.dig("snapshot", "config", "modules", 0, "pages", 0)
    assert_equal "screen", page.fetch("page_role")
    assert_equal "account.page-b", page.dig("behaviors", 0, "actions", 0, "destination")
  end

  def test_ambiguous_popup_migration_is_visible_and_blocks_validate_and_save
    fixture = JSON.parse(JSON.generate(ambiguous_v5_popup_config))
    File.write(@path, "# Header\n#{YAML.dump(fixture)}")

    snapshot_payload, err, status = run_bridge("snapshot", {})
    assert status.success?, err
    assert_equal 200, snapshot_payload.fetch("status"), snapshot_payload.inspect
    snapshot = snapshot_payload.fetch("snapshot")
    assert snapshot.fetch("issues").any? { |issue| issue.fetch("code") == "migration_required" }

    validate_payload, err, status = run_bridge("validate", { "config" => snapshot.fetch("config") })
    assert status.success?, err
    assert_equal 422, validate_payload.fetch("status")
    assert validate_payload.fetch("issues").any? { |issue| issue.fetch("code") == "migration_required" }

    save_payload, err, status = run_bridge("save", {
      "config" => snapshot.fetch("config"),
      "expected_revision" => snapshot.fetch("revision"),
      "acknowledge_comment_loss" => false
    })
    assert status.success?, err
    assert_equal 422, save_payload.fetch("status")
    assert save_payload.fetch("issues").any? { |issue| issue.fetch("code") == "migration_required" }
  end

  def test_save_writes_valid_draft_and_returns_new_snapshot
    original = run_bridge("snapshot", {}).first.dig("snapshot", "revision")
    draft = valid_config
    draft["modules"][0]["title"] = "Updated"

    payload, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => original,
      "acknowledge_comment_loss" => false
    })

    assert status.success?, err
    assert_equal 200, payload.fetch("status")
    refute_equal original, payload.dig("snapshot", "revision")
    assert_equal "Updated", YAML.safe_load(File.read(@path), aliases: false).dig("modules", 0, "title")
  end

  def test_save_of_done_page_requires_confirmation_without_writing
    completed = complete_page_with_two_states("page-a")
    original_text = File.read(@path)
    draft = deep_copy(completed.dig("snapshot", "config"))
    state(draft, "page-a", "loading")["figma_url"] = "https://www.figma.com/design/file/Page?node-id=9-9"

    payload, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision"),
      "confirm_amendments" => false
    })

    assert status.success?, err
    assert_equal 409, payload.fetch("status")
    assert_equal "amendment_required", payload.dig("error", "code")
    assert_equal ["loading"], payload.dig("error", "changes_by_page", "account.page-a", "states").map { |item| item.fetch("id") }
    assert_equal original_text, File.read(@path)
  end

  def test_confirmed_save_archives_and_reopens_only_changed_tasks
    completed = complete_page_with_two_states("page-a")
    draft = deep_copy(completed.dig("snapshot", "config"))
    page = page(draft, "page-a")
    state(draft, "page-a", "loading")["figma_url"] = "https://www.figma.com/design/file/Page?node-id=9-9"
    page.fetch("states") << {
      "id" => "offline",
      "title" => "Offline",
      "figma_url" => "https://www.figma.com/design/file/Page?node-id=2-3",
      "implementation_status" => "done"
    }
    removed_behavior = page.fetch("behaviors").pop.fetch("id")

    payload, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision"),
      "confirm_amendments" => true
    })

    assert status.success?, err
    assert_equal 200, payload.fetch("status")
    saved = payload.dig("snapshot", "config", "modules", 0, "pages", 0)
    assert_equal "in_progress", saved.fetch("status")
    assert_equal 2, saved.fetch("attempts")
    assert_equal "todo", saved.fetch("states").find { |item| item.fetch("id") == "loading" }.fetch("implementation_status")
    assert_equal "done", saved.fetch("states").find { |item| item.fetch("id") == "default" }.fetch("implementation_status")
    assert_equal "todo", saved.fetch("states").find { |item| item.fetch("id") == "offline" }.fetch("implementation_status")
    assert_equal [{
      "kind" => "behavior", "id" => removed_behavior, "implementation_status" => "todo"
    }], saved.fetch("removed_tasks")
    assert_equal "accepted123", saved.dig("acceptance_history", 0, "commit")
    assert_match(/behavior:#{removed_behavior}/, saved.fetch("reason"))
    assert_match(/state:loading/, saved.fetch("reason"))
  end

  def test_save_preserves_user_status_for_a_tool_owned_removed_task
    completed = complete_page_with_two_states("page-a")
    draft = deep_copy(completed.dig("snapshot", "config"))
    removed_behavior = page(draft, "page-a").fetch("behaviors").pop.fetch("id")
    amended = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision"),
      "confirm_amendments" => true
    }).first
    status_draft = deep_copy(amended.dig("snapshot", "config"))
    status_draft.dig("modules", 0, "pages", 0, "removed_tasks", 0)["implementation_status"] = "done"

    payload, err, status = run_bridge("save", {
      "config" => status_draft,
      "expected_revision" => amended.dig("snapshot", "revision")
    })

    assert status.success?, err
    assert_equal 200, payload.fetch("status")
    saved = payload.dig("snapshot", "config", "modules", 0, "pages", 0)
    assert_equal [{
      "kind" => "behavior", "id" => removed_behavior, "implementation_status" => "done"
    }], saved.fetch("removed_tasks")
  end

  def test_save_reconciles_restored_task_membership_in_the_written_yaml
    completed = complete_page_with_two_states("page-a")
    draft = deep_copy(completed.dig("snapshot", "config"))
    removed_behavior = page(draft, "page-a").fetch("behaviors").pop
    amended = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision"),
      "confirm_amendments" => true
    }).first
    restored_draft = deep_copy(amended.dig("snapshot", "config"))
    restored_page = page(restored_draft, "page-a")
    restored_page.fetch("behaviors") << removed_behavior.merge("implementation_status" => "done")
    restored_page["removed_tasks"] = []

    payload, err, status = run_bridge("save", {
      "config" => restored_draft,
      "expected_revision" => amended.dig("snapshot", "revision")
    })

    assert status.success?, err
    assert_equal 200, payload.fetch("status")
    assert_equal [], payload.dig("snapshot", "config", "modules", 0, "pages", 0, "removed_tasks")
    written = YAML.safe_load(File.read(@path), aliases: false)
    assert_equal [], page(written, "page-a").fetch("removed_tasks")
  end

  def test_status_uses_domain_lifecycle_rules
    revision = run_bridge("snapshot", {}).first.dig("snapshot", "revision")

    payload, err, status = run_bridge("status", {
      "action" => "claim",
      "module_id" => "account",
      "page_id" => "page-a",
      "expected_revision" => revision
    })

    assert status.success?, err
    assert_equal 200, payload.fetch("status")
    assert_equal "in_progress", payload.dig("snapshot", "config", "modules", 0, "pages", 0, "status")
  end

  def test_manual_reopening_of_a_done_task_requires_confirmation
    completed = complete_page_with_two_states("page-a")
    draft = deep_copy(completed.dig("snapshot", "config"))
    state(draft, "page-a", "default")["implementation_status"] = "todo"

    payload, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision")
    })

    assert status.success?, err
    assert_equal 409, payload.fetch("status")
    assert_equal "amendment_required", payload.dig("error", "code")
    assert_equal "unchanged", payload.dig("error", "changes_by_page", "account.page-a", "states", 0, "change")
    assert_equal "todo", payload.dig("error", "changes_by_page", "account.page-a", "states", 0, "implementation_status")
  end

  def test_forged_draft_baseline_cannot_bypass_amendment_confirmation
    completed = complete_page_with_two_states("page-a")
    draft = deep_copy(completed.dig("snapshot", "config"))
    changed_url = "https://www.figma.com/design/file/Page?node-id=9-9"
    state(draft, "page-a", "loading")["figma_url"] = changed_url
    page(draft, "page-a").fetch("accepted_baseline").fetch("states").find { |item| item.fetch("id") == "loading" }["figma_url"] = changed_url

    payload, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision")
    })

    assert status.success?, err
    assert_equal 409, payload.fetch("status")
    assert_equal "amendment_required", payload.dig("error", "code")
  end

  def test_multiple_done_pages_are_summarized_and_amended_together
    complete_page_with_two_states("page-a")
    completed = complete_page_with_two_states("page-b")
    draft = deep_copy(completed.dig("snapshot", "config"))
    state(draft, "page-a", "loading")["figma_url"] = "https://www.figma.com/design/file/Page?node-id=9-9"
    state(draft, "page-b", "loading")["figma_url"] = "https://www.figma.com/design/file/Page?node-id=8-8"

    preflight, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision")
    })
    assert status.success?, err
    assert_equal ["account.page-a", "account.page-b"], preflight.dig("error", "changes_by_page").keys.sort

    payload, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision"),
      "confirm_amendments" => true
    })
    assert status.success?, err
    assert_equal 200, payload.fetch("status")
    pages = payload.dig("snapshot", "config", "modules", 0, "pages")
    assert_equal ["in_progress"], pages.map { |item| item.fetch("status") }.uniq
    assert_equal [2], pages.map { |item| item.fetch("attempts") }.uniq
  end

  def test_deleting_a_done_page_is_rejected_without_writing
    completed = complete_page_with_two_states("page-b")
    original_text = File.read(@path)
    draft = deep_copy(completed.dig("snapshot", "config"))
    page(draft, "page-a").fetch("behaviors").first.tap do |behavior|
      behavior["state_change"] = "default"
      behavior.delete("actions")
    end
    draft.fetch("modules").first.fetch("pages").reject! { |item| item.fetch("id") == "page-b" }

    payload, err, status = run_bridge("save", {
      "config" => draft,
      "expected_revision" => completed.dig("snapshot", "revision")
    })

    assert status.success?, err
    assert_equal 422, payload.fetch("status")
    assert_equal "domain_error", payload.dig("error", "code")
    assert_match(/amended before removal/, payload.dig("error", "message"))
    assert_equal original_text, File.read(@path)
  end

  def test_status_can_amend_a_completed_page_and_preserve_its_baseline
    revision = run_bridge("snapshot", {}).first.dig("snapshot", "revision")
    run_bridge("status", {
      "action" => "claim",
      "module_id" => "account",
      "page_id" => "page-a",
      "expected_revision" => revision
    })
    mark_current_tasks_done("page-a")
    completion_revision = run_bridge("snapshot", {}).first.dig("snapshot", "revision")
    completed = run_bridge("status", {
      "action" => "complete",
      "module_id" => "account",
      "page_id" => "page-a",
      "expected_revision" => completion_revision,
      "commit" => "accepted123"
    }).first

    payload, err, status = run_bridge("status", {
      "action" => "amend",
      "module_id" => "account",
      "page_id" => "page-a",
      "expected_revision" => completed.dig("snapshot", "revision"),
      "reason" => "Updated design"
    })

    assert status.success?, err
    assert_equal 200, payload.fetch("status")
    page = payload.dig("snapshot", "config", "modules", 0, "pages", 0)
    assert_equal "in_progress", page.fetch("status")
    assert_equal "accepted123", page.dig("acceptance_history", 0, "commit")
    assert_equal "Updated design", page.dig("acceptance_history", 0, "amendment_reason")
  end

  def test_unknown_operation_is_rejected
    payload, _err, status = run_bridge("execute", {})

    refute status.success?
    assert_equal 400, payload.fetch("status")
    assert_equal "invalid_request", payload.dig("error", "code")
  end

  def test_malformed_json_is_rejected
    out, _err, status = Open3.capture3(
      RbConfig.ruby, BRIDGE, "snapshot", "--config", @path,
      stdin_data: "{"
    )

    refute status.success?
    assert_equal 400, JSON.parse(out).fetch("status")
  end

  private

  def run_bridge(operation, payload)
    out, err, status = Open3.capture3(
      RbConfig.ruby, BRIDGE, operation, "--config", @path,
      stdin_data: JSON.generate(payload)
    )
    [JSON.parse(out), err, status]
  end

  def mark_current_tasks_done(page_id)
    config = YAML.safe_load(File.read(@path), aliases: false)
    page = config.fetch("modules").first.fetch("pages").find { |item| item.fetch("id") == page_id }
    page.fetch("states").each { |task| task["implementation_status"] = "done" }
    page.fetch("behaviors").each { |task| task["implementation_status"] = "done" }
    File.write(@path, YAML.dump(config))
  end

  def complete_page_with_two_states(page_id)
    claimed = run_bridge("status", {
      "action" => "claim",
      "module_id" => "account",
      "page_id" => page_id,
      "expected_revision" => run_bridge("snapshot", {}).first.dig("snapshot", "revision")
    }).first
    config = YAML.safe_load(File.read(@path), aliases: false)
    page(config, page_id).fetch("states") << {
      "id" => "loading",
      "title" => "Loading",
      "figma_url" => "https://www.figma.com/design/file/Page?node-id=2-2",
      "implementation_status" => "done"
    }
    File.write(@path, YAML.dump(config))
    mark_current_tasks_done(page_id)
    completed = run_bridge("status", {
      "action" => "complete",
      "module_id" => "account",
      "page_id" => page_id,
      "expected_revision" => run_bridge("snapshot", {}).first.dig("snapshot", "revision"),
      "commit" => "accepted123"
    }).first
    assert_equal "in_progress", page(claimed.dig("snapshot", "config"), page_id).fetch("status")
    completed
  end

  def page(config, page_id)
    config.fetch("modules").first.fetch("pages").find { |item| item.fetch("id") == page_id }
  end

  def state(config, page_id, state_id)
    page(config, page_id).fetch("states").find { |item| item.fetch("id") == state_id }
  end

  def deep_copy(value)
    Marshal.load(Marshal.dump(value))
  end

  def valid_config
    {
      "schema_version" => 1,
      "execution" => { "parallel" => false, "max_parallel" => 2 },
      "modules" => [{
        "id" => "account",
        "title" => "Account",
        "entry_page" => "page-a",
        "pages" => [page_config("page-a", {
          "id" => "to-page-b",
          "action" => "tap_continue",
          "style" => "push",
          "destination" => "account.page-b"
        }), page_config("page-b", {
          "id" => "close",
          "action" => "tap_close",
          "style" => "back"
        })]
      }]
    }
  end

  def ambiguous_v5_popup_config
    lifecycle = {
      "page_type" => "view", "status" => "todo", "attempts" => 0,
      "commit" => nil, "reason" => nil, "started_at" => nil, "completed_at" => nil,
      "acceptance_history" => [], "accepted_baseline" => nil, "removed_tasks" => [],
      "data_dependencies" => [],
      "states" => [{
        "id" => "default", "title" => "Default",
        "figma_url" => "https://www.figma.com/design/file/Page?node-id=1-1",
        "implementation_status" => "todo"
      }],
      "behaviors" => []
    }
    interaction = lambda do |id, target, trigger, actions|
      {
        "id" => id, "type" => "interaction", "target" => target,
        "implementation_status" => "todo", "trigger" => trigger,
        "actions" => actions, "run_policy" => "every_time"
      }
    end
    home = lifecycle.merge(
      "id" => "home", "title" => "Home", "page_role" => "screen",
      "behaviors" => [
        interaction.call("open", "delete_button", { "event" => "tap" }, [{
          "type" => "present_popup", "destination" => "common.confirmation",
          "parameters" => {
            "title" => "delete_title", "confirmed_text" => "confirm_text", "unknown" => "keep_me"
          }
        }]),
        interaction.call("confirmed", "confirmation", {
          "event" => "popup_result", "source" => "open", "result" => "confirmed"
        }, [{ "type" => "navigate", "style" => "push", "destination" => "app.result" }])
      ]
    )
    result = lifecycle.merge("id" => "result", "title" => "Result", "page_role" => "screen")
    popup = lifecycle.merge(
      "id" => "confirmation", "title" => "Confirmation", "page_role" => "popup",
      "behaviors" => [interaction.call("confirm", "primary_button", { "event" => "tap" }, [{
        "type" => "return_popup_result", "result" => "confirmed"
      }])]
    )
    {
      "schema_version" => 5,
      "delivery" => { "profile" => "strict" },
      "execution" => { "parallel" => false, "max_parallel" => 2 },
      "system_ui" => { "tab_bar_controller" => false, "picker" => false },
      "mock_data_sources" => [],
      "modules" => [
        { "id" => "app", "title" => "App", "entry_page" => "home", "pages" => [home, result] },
        { "id" => "common", "title" => "Common", "entry_page" => nil, "pages" => [popup] }
      ]
    }
  end

  def page_config(id, transition)
    {
      "id" => id,
      "title" => id,
      "page_type" => "view",
      "status" => "todo",
      "attempts" => 0,
      "commit" => nil,
      "reason" => nil,
      "started_at" => nil,
      "completed_at" => nil,
      "acceptance_history" => [],
      "states" => [{
        "id" => "default",
        "title" => "Default",
        "figma_url" => "https://www.figma.com/design/file/Page?node-id=1-2"
      }],
      "navigation" => { "transitions" => [transition] }
    }
  end

  def valid_v2_config
    {
      "schema_version" => 2,
      "execution" => { "parallel" => false, "max_parallel" => 2 },
      "modules" => [{
        "id" => "account",
        "title" => "Account",
        "entry_page" => "page-a",
        "pages" => [v2_page_config("page-a", {
          "type" => "navigate",
          "style" => "push",
          "destination" => "account.page-b"
        }), v2_page_config("page-b", { "type" => "navigate", "style" => "back" })]
      }]
    }
  end

  def v2_page_config(id, action)
    {
      "id" => id,
      "title" => id,
      "page_type" => "view",
      "status" => "todo",
      "attempts" => 0,
      "commit" => nil,
      "reason" => nil,
      "started_at" => nil,
      "completed_at" => nil,
      "acceptance_history" => [],
      "states" => [{
        "id" => "default",
        "title" => "Default",
        "figma_url" => "https://www.figma.com/design/file/Page?node-id=1-2"
      }],
      "behaviors" => [{
        "id" => "route",
        "type" => "interaction",
        "target" => "continue",
        "trigger" => { "event" => "tap" },
        "action" => action,
        "run_policy" => "every_time"
      }]
    }
  end
end
